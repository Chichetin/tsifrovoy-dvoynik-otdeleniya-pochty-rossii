/**
 * #127: voice input for the agent chat (D-374). The browser's Web Speech API
 * turns speech into text; the text is appended to the question field and the
 * person sends it with the usual button. No server, no package. Chrome sends
 * the audio to Google; the microphone needs HTTPS or localhost.
 */

import { useEffect, useRef, useState } from 'react';

/** The part of the Web Speech API this module uses; lib.dom has no types for it. */
type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = { isFinal: boolean; length: number; [index: number]: SpeechRecognitionAlternativeLike };
type SpeechRecognitionEventLike = { resultIndex: number; results: { length: number; [index: number]: SpeechRecognitionResultLike } };
type SpeechRecognitionErrorEventLike = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const INSECURE_TEXT = 'Микрофон не включится: браузер даёт его только по HTTPS или на localhost, а эта страница открыта по HTTP. Введите вопрос текстом.';

function errorText(code: string): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return window.isSecureContext
        ? 'Нет доступа к микрофону. Разрешите микрофон для этого сайта в настройках браузера и нажмите кнопку ещё раз.'
        : INSECURE_TEXT;
    case 'network':
      return 'Нет сети: браузер распознаёт речь через свой онлайн-сервис. Проверьте интернет или введите вопрос текстом.';
    case 'audio-capture':
      return 'Микрофон не найден. Подключите микрофон или введите вопрос текстом.';
    case 'no-speech':
      return 'Речь не услышана. Нажмите кнопку и скажите вопрос ещё раз.';
    case 'language-not-supported':
      return 'Браузер не распознаёт русскую речь. Введите вопрос текстом.';
    default:
      return `Распознать речь не удалось (${code}). Введите вопрос текстом.`;
  }
}

type Props = {
  /** Called with each recognised phrase; the caller appends it to the field with a functional update. */
  onText: (text: string) => void;
};

/** The microphone button and its status line. Renders nothing without the Web Speech API. */
export function VoiceInput({ onText }: Props): React.JSX.Element | null {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => recognition.current?.abort(), []);

  const Recognition = recognitionConstructor();
  if (Recognition === null) return null;

  function start(Ctor: SpeechRecognitionConstructor): void {
    setError(null);
    if (!window.isSecureContext) {
      setError(INSECURE_TEXT);
      return;
    }
    const instance = new Ctor();
    instance.lang = 'ru-RU';
    instance.continuous = false;
    instance.interimResults = false;
    instance.maxAlternatives = 1;
    instance.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript.trim() ?? '';
        if (result?.isFinal === true && text !== '') onText(text);
      }
    };
    instance.onerror = (event) => setError(errorText(event.error));
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setError('Распознать речь не удалось. Введите вопрос текстом.');
    }
  }

  return (
    <>
      <button
        type="button"
        className="files__button"
        aria-pressed={listening}
        title="Голосовой ввод: речь распознаёт браузер (в Chrome — сервис Google)"
        onClick={() => (listening ? recognition.current?.stop() : start(Recognition))}
      >
        {listening ? 'Остановить запись' : 'Сказать голосом'}
      </button>
      <span className="agent__hint" role="status" aria-atomic="true">{listening ? 'Слушаю…' : ''}</span>
      {error === null ? null : <p className="files__error agent__voice-error" role="alert">{error}</p>}
    </>
  );
}
