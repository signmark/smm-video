#!/usr/bin/env python3
"""
SilentSentry: Ultrasonic Tracker Scanner & Sanitizer
Part of the SilentSentry Product Suite
"""

import os
import sys
import json
import hashlib
import subprocess
import numpy as np

def run_command(cmd):
    """Utility to run shell command and return stdout/stderr."""
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.returncode, result.stdout, result.stderr

def get_audio_duration(file_path):
    """Retrieve audio duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nocli=1", file_path
    ]
    ret, out, _ = run_command(cmd)
    if ret == 0 and out:
        try:
            return float(out.decode().strip())
        except ValueError:
            pass
    return 0.0

def analyze_audio(file_path, sample_rate=44100):
    """
    Reads audio chunks, performs FFT, and detects energy levels in the
    ultrasonic band (18.5 kHz - 22 kHz) compared to the human audible band.
    """
    # Convert file to raw 16-bit mono PCM stream
    cmd = [
        "ffmpeg", "-y", "-i", file_path,
        "-f", "s16le", "-acodec", "pcm_s16le",
        "-ar", str(sample_rate), "-ac", "1", "-"
    ]
    
    # We will read chunks of audio to process FFT
    chunk_size = 8192  # FFT size
    overlap = 2048
    
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    ultrasonic_energies = []
    audible_energies = []
    beacons_detected = []
    
    # Frequency bins corresponding to sample_rate & chunk_size
    frequencies = np.fft.rfftfreq(chunk_size, d=1.0/sample_rate)
    
    # Indexes of specific bands
    idx_audible = (frequencies >= 1000) & (frequencies <= 12000)
    idx_ultrasonic = (frequencies >= 18500) & (frequencies <= 22000)
    
    bytes_per_sample = 2  # 16-bit
    chunk_bytes = chunk_size * bytes_per_sample
    
    while True:
        data = process.stdout.read(chunk_bytes)
        if not data:
            break
        if len(data) < chunk_bytes:
            # Pad with zeros
            data += b'\x00' * (chunk_bytes - len(data))
            
        # Convert bytes to int16 numpy array
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32)
        
        # Apply Hanning window
        windowed = samples * np.hanning(chunk_size)
        
        # FFT
        fft_result = np.abs(np.fft.rfft(windowed))
        
        # Energy calculation
        aud_energy = np.mean(fft_result[idx_audible]) if np.any(idx_audible) else 1e-5
        ult_energy = np.mean(fft_result[idx_ultrasonic]) if np.any(idx_ultrasonic) else 1e-5
        
        audible_energies.append(aud_energy)
        ultrasonic_energies.append(ult_energy)
        
        # A simple ratio detection: if ultrasonic energy is exceptionally high
        # compared to standard noise levels or relative audible levels
        # (Tracking beacons are high-power sine sweeps or chirp pulses)
        ratio = ult_energy / (aud_energy + 1e-5)
        # Beacons typically peak in narrow bands above 19kHz
        peak_ultrasonic = np.max(fft_result[idx_ultrasonic]) if np.any(idx_ultrasonic) else 0.0
        
        # Threshold for hidden active beacon (calibrated ratio or absolute peak)
        if peak_ultrasonic > 500.0 and ratio > 0.08:
            beacons_detected.append(True)
        else:
            beacons_detected.append(False)
            
    process.wait()
    
    # Calculate global metrics
    if not ultrasonic_energies:
        return {"error": "Could not read audio data"}
        
    avg_ultrasonic = float(np.mean(ultrasonic_energies))
    max_ultrasonic = float(np.max(ultrasonic_energies))
    avg_audible = float(np.mean(audible_energies))
    
    beacon_probability = 0.0
    if len(beacons_detected) > 0:
        beacon_probability = sum(beacons_detected) / len(beacons_detected)
        # Cap/scale probability for realistic assessment
        beacon_probability = min(1.0, beacon_probability * 5.0)
        
    return {
        "duration_sec": get_audio_duration(file_path),
        "avg_ultrasonic_energy": avg_ultrasonic,
        "max_ultrasonic_energy": max_ultrasonic,
        "avg_audible_energy": avg_audible,
        "beacon_detected": beacon_probability > 0.15,
        "beacon_probability": float(beacon_probability),
        "sampling_rate_hz": sample_rate
    }

def sanitize_audio(input_path, output_path, cutoff=18000):
    """
    Applies a steep brickwall-like lowpass filter at 18kHz
    to sanitize hidden ultrasonic tracking signals.
    """
    # -af "lowpass=f=18000" applies a butterworth-like lowpass filter.
    # To make it extra steep, we chain it twice or use a high-order filter.
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-af", f"lowpass=f={cutoff}:t=h,lowpass=f={cutoff}:t=h",
        "-c:a", "libmp3lame", "-q:a", "2",  # High quality MP3 encoding
        output_path
    ]
    ret, _, err = run_command(cmd)
    if ret != 0:
        raise Exception(f"FFmpeg sanitization failed: {err.decode()}")
        
    # Calculate SHA256 checksum of sanitized file for security certificate
    sha = hashlib.sha256()
    with open(output_path, 'rb') as f:
        while chunk := f.read(8192):
            sha.update(chunk)
            
    return {
        "sanitized_file_path": os.path.abspath(output_path),
        "sanitized_file_size_bytes": os.path.getsize(output_path),
        "sha256_checksum": sha.hexdigest(),
        "cutoff_frequency_hz": cutoff
    }

def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ["scan", "clean", "full"]:
        print("SilentSentry Engine v1.0.0")
        print("Usage:")
        print("  silentsentry.py scan <input_audio>")
        print("  silentsentry.py clean <input_audio> <output_audio>")
        print("  silentsentry.py full <input_audio> <output_audio>")
        sys.exit(1)
        
    mode = sys.argv[1]
    input_file = sys.argv[2]
    
    if not os.path.exists(input_file):
        print(json.dumps({"error": f"Input file not found: {input_file}"}))
        sys.exit(1)
        
    try:
        if mode == "scan":
            result = analyze_audio(input_file)
            print(json.dumps(result, indent=2))
            
        elif mode == "clean":
            output_file = sys.argv[3]
            result = sanitize_audio(input_file, output_file)
            print(json.dumps(result, indent=2))
            
        elif mode == "full":
            output_file = sys.argv[3]
            scan_before = analyze_audio(input_file)
            clean_result = sanitize_audio(input_file, output_file)
            scan_after = analyze_audio(output_file)
            
            full_report = {
                "engine": "SilentSentry v1.0.0",
                "input_file": os.path.abspath(input_file),
                "scan_before": scan_before,
                "sanitization": clean_result,
                "scan_after": scan_after,
                "status": "SECURE" if not scan_after["beacon_detected"] else "COMPROMISED"
            }
            print(json.dumps(full_report, indent=2))
            
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
