import { useState, useEffect } from "react";

const COOKIE_KEY = "smm_cookie_consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_KEY);
    if (!consent) setVisible(true);
  }, []);

  if (!visible) return null;

  function acceptAll() {
    localStorage.setItem(COOKIE_KEY, JSON.stringify({ necessary: true, analytics: true, marketing: true, ts: Date.now() }));
    setVisible(false);
  }

  function acceptNecessary() {
    localStorage.setItem(COOKIE_KEY, JSON.stringify({ necessary: true, analytics: false, marketing: false, ts: Date.now() }));
    setVisible(false);
  }

  return (
    <div
      data-testid="cookie-banner"
      className="fixed bottom-0 left-0 right-0 z-[9999] bg-[#1a2535] text-white shadow-2xl"
    >
      {!showDetails ? (
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1 text-sm leading-relaxed text-gray-200">
            Мы используем файлы cookie для улучшения работы сайта, анализа трафика и персонализации контента.
            Нажимая «Принять все», вы соглашаетесь с использованием всех файлов cookie.{" "}
            <button
              onClick={() => setShowDetails(true)}
              className="underline text-blue-300 hover:text-blue-200 whitespace-nowrap"
            >
              Настроить
            </button>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              data-testid="cookie-accept-necessary"
              onClick={acceptNecessary}
              className="px-4 py-2 text-sm rounded border border-gray-500 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Только необходимые
            </button>
            <button
              data-testid="cookie-accept-all"
              onClick={acceptAll}
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
            >
              Принять все
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-base">Настройки cookie</h3>
            <button onClick={() => setShowDetails(false)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
          </div>
          <div className="grid gap-3 mb-4">
            {[
              { key: "necessary", label: "Необходимые", desc: "Требуются для работы сайта. Не могут быть отключены.", always: true },
              { key: "analytics", label: "Аналитика", desc: "Помогают понять, как посетители используют сайт (Google Analytics).", always: false },
              { key: "marketing", label: "Маркетинг", desc: "Используются для показа релевантной рекламы.", always: false },
            ].map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-4 p-3 rounded bg-white/5">
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{item.desc}</div>
                </div>
                <div className="shrink-0 text-xs text-gray-400 mt-1">
                  {item.always ? "Всегда активны" : ""}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              data-testid="cookie-details-necessary"
              onClick={acceptNecessary}
              className="px-4 py-2 text-sm rounded border border-gray-500 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Только необходимые
            </button>
            <button
              data-testid="cookie-details-accept-all"
              onClick={acceptAll}
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
            >
              Принять все
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
