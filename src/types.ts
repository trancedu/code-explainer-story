export type ExplanationLevel = 'concise' | 'medium' | 'detailed' | 'story';

export type ReviewSeverity = 'info' | 'warning' | 'error';

export type ReviewCategory =
  | 'correctness'
  | 'readability'
  | 'maintainability'
  | 'performance'
  | 'security'
  | 'typing'
  | 'style';

export type CodeChunk = {
  id: string;
  startLine: number;
  endLine: number;
  kind: string;
  symbolPath: string;
  code: string;
};

export type FilePayload = {
  fileName: string;
  languageId: string;
  totalLines: number;
  explanationLevel: ExplanationLevel;
  reviewEnabled: boolean;
  chunks: CodeChunk[];
};

export type ExplanationLine = {
  line: number;
  text: string;
};

export type ReviewItem = {
  startLine: number;
  endLine: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  suggestion: string;
};

export type ExplanationChunk = {
  id: string;
  startLine: number;
  endLine: number;
  summary: string;
  lines: ExplanationLine[];
  review: ReviewItem[];
};

export type ExplanationResponse = {
  fileSummary: string;
  chunks: ExplanationChunk[];
};

export type RenderedExplanation = {
  text: string;
  lines: string[];
  reviewItems: ReviewItem[];
  fileSummary: string;
};

export type ExplanationRequestKey = {
  sourceUri: string;
  documentVersion: number;
  contentHash: string;
  level: ExplanationLevel;
  reviewEnabled: boolean;
  model: string;
};
