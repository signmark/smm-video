# SilentSentry: Hidden Ultrasonic Beacon Sanitizer & Podcast Privacy Shield

SilentSentry is an ultra-premium, highly trendy privacy utility designed to scan, analyze, and purge audio streams of hidden **cross-device tracking (xDT) beacons** in the ultrasonic spectrum (>18.5 kHz). 

By applying a sharp brickwall-like Low-Pass filter, it renders silent ad-tracking beacons completely dead while preserving 100% of the audible audio quality (speech, high-fidelity music) for human listeners.

---

## 🛠️ Tech Stack & Architecture

1. **Backend Engine (`silentsentry.py`):**
   - Implemented in Python 3.
   - Core DSP powered by `ffmpeg` (`lowpass` steep filters chained together for -48dB/oct attenuation).
   - Spectrum analysis powered by `numpy` via Discrete Fast Fourier Transform (FFT) with a Hanning window (to prevent spectral leakage).
   - Scans and detects peak energy in the `18.5 kHz - 22 kHz` range compared to average audible bounds.
   - Outputs complete cryptographic security compliance certificates with file hashes (SHA-256).

2. **Frontend Sandbox (`index.html`):**
   - Styled using **ElevenLabs dark cinematic design system** (warm void-black, elegant typography, positive tracked letter-spacing, sub-0.1 opacity shadows).
   - Dynamic interactive spectrum analyzer written in pure HTML5 Canvas (animating the real-time frequency distribution, showing active ultrasonic spikes, and simulating the exact low-pass cut).
   - Stateful client-side prototype built in **React** via CDN.
   - Full product positioning, monetization tiers ($0 / $19 / $149 per month), and deep-dive technical explanations.

---

## 🚀 Quick Start (CLI Engine)

The engine runs directly inside the virtual environment `/opt/hermes/.venv/bin/python3`.

### 1. Scan an audio file for tracking beacons:
```bash
/opt/hermes/.venv/bin/python3 silentsentry.py scan podcast.mp3
```

### 2. Sanitize and filter out everything above 18kHz:
```bash
/opt/hermes/.venv/bin/python3 silentsentry.py clean podcast.mp3 sanitized_podcast.mp3
```

### 3. Full report (Scan before -> Sanitize -> Scan after):
```bash
/opt/hermes/.venv/bin/python3 silentsentry.py full podcast.mp3 sanitized_podcast.mp3
```

---

## 🎨 Interactive Sandbox
Open `/opt/data/silentsentry/index.html` in any browser to experience the live simulation dashboard, test the visual interactive FFT analyzer, and configure cutoff threshold sliders.
