'use client';

import { useState } from 'react';
import { GenerativeProgress } from './GenerativeProgress';
import { useCanvas } from '../experience/context';

const DEMO_PROMPTS = [
  'Why does this fit my family?',
  'What is included in the verified price?',
  'Is balcony availability live?',
  'What travel documents do children need?',
] as const;

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2z" />
    </svg>
  );
}

export function BottomIntentBar() {
  const {
    stage,
    askVoyageQuestion,
    loading,
    policyNarrative,
    policyStreaming,
    materializePhase,
    statusMessage,
    error,
  } = useCanvas();
  const [questionDraft, setQuestionDraft] = useState('');

  if (stage === 'intent' || stage === 'fallback') return null;

  const showSteps = loading && materializePhase;
  const canvasBusy = loading && !policyStreaming;
  const questionInputDisabled = canvasBusy;
  const questionSubmitDisabled =
    questionInputDisabled || policyStreaming || !questionDraft.trim();
  const actionDisabled = canvasBusy || policyStreaming;

  const submitQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || questionInputDisabled || policyStreaming) return;
    setQuestionDraft('');
    void askVoyageQuestion(trimmed);
  };

  return (
    <div className="vc-question-dock" aria-label="Ask about this voyage">
      <div className="vc-question-dock__prompts" role="group" aria-label="Demo prompts">
        {DEMO_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={actionDisabled}
            onClick={() => submitQuestion(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      <form
        className="vc-gen-bar vc-question-bar"
        onSubmit={(e) => {
          e.preventDefault();
          submitQuestion(questionDraft);
        }}
      >
        <span className="vc-gen-bar__sparkle" aria-hidden="true">
          <SparkleIcon />
        </span>
        <label htmlFor="voyage-question" className="visually-hidden">
          Ask anything about your voyage
        </label>
        <input
          id="voyage-question"
          type="text"
          value={questionDraft}
          disabled={questionInputDisabled}
          onChange={(e) => setQuestionDraft(e.target.value)}
          placeholder={
            policyStreaming
              ? 'Type your next question while this answer finishes...'
              : 'Ask anything about this voyage...'
          }
        />
        <button
          type="submit"
          className="vc-question-bar__send"
          disabled={questionSubmitDisabled}
          aria-label="Ask question"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>

      <div
        className="vc-question-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {showSteps ? (
          <GenerativeProgress compact />
        ) : error ? (
          <span style={{ color: 'var(--error)' }}>{error}</span>
        ) : loading || policyStreaming ? (
          'Working from verified data and approved policy...'
        ) : policyNarrative ? (
          <>
            {policyNarrative.slice(0, 180)}
            {policyNarrative.length > 180 ? '...' : ''}
          </>
        ) : (
          statusMessage
        )}
      </div>
    </div>
  );
}
