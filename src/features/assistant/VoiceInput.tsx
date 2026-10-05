/**
 * #127: voice input for the agent chat (D-374). The browser's Web Speech API
 * turns speech into text; the text is appended to the question field and the
 * person sends it with the usual button. No server, no package. Chrome sends
 * the audio to Google; the microphone needs HTTPS or localhost.
 *
 * #181: one press records a whole question, pauses included. Recognition is
 * continuous; the code ends it after a silence (SILENCE_MS after the last
 * heard word), when nothing is heard (NO_SPEECH_MS) or at MAX_MS. Every way
 * the session ends says what happened: text in the field or a Russian message.
 */

import { useEffect, useRef, useState } from 'react';
import './voice-input.css';

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

/** Silence after the last heard word that ends the question. */
const SILENCE_MS = 2500;
/** Time to start speaking before the session ends with «Речь не услышана». */
const NO_SPEECH_MS = 8000;
/** One question is never longer than this. */
const MAX_MS = 60000;

const INSECURE_TEXT = 'Микрофон не включится: браузер даёт его только по HTTPS или на localhost, а эта страница открыта по HTTP. Введите вопрос текстом.';
const NO_SPEECH_TEXT = 'Речь не услышана. Проверьте, что микрофон включён, нажмите кнопку и скажите вопрос ещё раз.';

function errorText(code: string): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
      return window.isSecureContext
        ? 'Нет доступа к микрофону. Разрешите микрофон для этого сайта (значок слева в адресной строке) и нажмите кнопку ещё раз.'
        : INSECURE_TEXT;
    case 'service-not-allowed':
      return window.isSecureContext
        ? 'Браузер не разрешил распознавание речи. Откройте страницу в Google Chrome или введите вопрос текстом.'
        : INSECURE_TEXT;
    case 'network':
      return 'Сервис распознавания речи недоступен. Браузер распознаёт речь через интернет: проверьте сеть или откройте страницу в Google Chrome. Вопрос можно ввести текстом.';
    case 'audio-capture':
      return 'Микрофон не найден или занят другой программой. Подключите микрофон или введите вопрос текстом.';
    case 'no-speech':
      return NO_SPEECH_TEXT;
    case 'language-not-supported':
      return 'Браузер не распознаёт русскую речь. Введите вопрос текстом.';
    default:
      return `Распознать речь не удалось (код: ${code}). Введите вопрос текстом.`;
  }
}

type Props = {
  /** Called with each recognised phrase; the caller appends it to the field with a functional update. */
  onText: (text: string) => void;
  /** Called when a session that produced text ends; the caller moves focus to the field. */
  onDone?: () => void;
};

/** The microphone button and its messages. Renders nothing without the Web Speech API. */
export function VoiceInput({ onText, onDone }: Props): React.JSX.Element | null {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timers = useRef<{ silence?: number; max?: number }>({});

  function clearTimers(): void {
    window.clearTimeout(timers.current.silence);
    window.clearTimeout(timers.current.max);
    timers.current = {};
  }

  useEffect(
    () => () => {
      clearTimers();
      const instance = recognition.current;
      if (instance === null) return;
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;
      instance.abort();
    },
    [],
  );

  const Recognition = recognitionConstructor();
  if (Recognition === null) return null;

  function start(Ctor: SpeechRecognitionConstructor): void {
    setError(null);
    if (!window.isSecureContext) {
      setError(INSECURE_TEXT);
      return;
    }
    let heard = false;
    let failed = false;
    const instance = new Ctor();
    const waitForSilence = (ms: number): void => {
      window.clearTimeout(timers.current.silence);
      timers.current.silence = window.setTimeout(() => instance.stop(), ms);
    };
    instance.lang = 'ru-RU';
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;
    instance.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript.trim() ?? '';
        if (result?.isFinal === true && text !== '') {
          heard = true;
          onText(text);
        }
      }
      // An interim result also means the person is still speaking.
      waitForSilence(SILENCE_MS);
    };
    instance.onerror = (event) => {
      failed = true;
      setError(errorText(event.error));
    };
    instance.onend = () => {
      clearTimers();
      recognition.current = null;
      setListening(false);
      if (heard) {
        // Focus moves to the field only from the button: the person did not go elsewhere.
        if (document.activeElement === button.current) onDone?.();
      } else if (!failed) {
        setError(NO_SPEECH_TEXT);
      }
    };
    recognition.current = instance;
    try {
      instance.start();
    } catch {
      recognition.current = null;
      setError('Распознать речь не удалось. Введите вопрос текстом.');
      return;
    }
    setListening(true);
    waitForSilence(NO_SPEECH_MS);
    timers.current.max = window.setTimeout(() => instance.stop(), MAX_MS);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={listening ? 'files__button voice__button is-listening' : 'files__button voice__button'}
        title={listening
          ? 'Нажмите, чтобы закончить. Запись закончится сама после паузы.'
          : 'Голосовой ввод: речь распознаёт браузер (в Chrome — сервис Google, нужен интернет)'}
        onClick={() => (listening ? recognition.current?.stop() : start(Recognition))}
      >
        <span className="voice__icon" aria-hidden="true">
          {listening ? (
            <span className="voice__dot" />
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
              <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" />
              <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          )}
        </span>
        {/* Both labels share one grid cell: the button keeps its width when the label changes. */}
        <span className="voice__labels">
          <span className={listening ? 'voice__label is-hidden' : 'voice__label'}>Сказать голосом</span>
          <span className={listening ? 'voice__label' : 'voice__label is-hidden'}>Слушаю — закончить</span>
        </span>
      </button>
      <span className="agent__sr" role="status" aria-atomic="true">{listening ? 'Слушаю. Скажите вопрос.' : ''}</span>
      {error === null ? null : <p className="files__error agent__voice-error" role="alert">{error}</p>}
    </>
  );
}
