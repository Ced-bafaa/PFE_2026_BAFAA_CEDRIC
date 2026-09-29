export type SubmissionPhase =
  | 'depose'
  | 'en_evaluation'
  | 'clarification'
  | 'negociation'
  | 'attribue'
  | 'rejete';

export type TrackingLine = {
  phase: SubmissionPhase;
  notes: string[];
};

export type SubmissionTrackingItem = {
  lines: TrackingLine[];
  updatedAt: string;
};

export type TrackingMap = Record<string, SubmissionTrackingItem>;
