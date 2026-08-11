import type {
  AuthenticationState,
  BookingContext,
  Evidence,
  ExperienceStage,
  Hold,
  LockedPreference,
  SearchCriteria,
  UncertaintyState,
  VoyageOption,
} from './domain.js';

export interface VoyageExperience {
  sessionId: string;
  authenticationState: AuthenticationState;
  stage: ExperienceStage;
  criteria: SearchCriteria;
  confirmedCriteria: Partial<SearchCriteria>;
  lockedPreferences: LockedPreference[];
  availableOptions: VoyageOption[];
  evidence: Evidence[];
  selectedOptionId?: string;
  compareOptionIds: string[];
  activeDecision?: string;
  uncertainty?: UncertaintyState;
  hold?: Hold;
  bookingContext?: BookingContext;
  guestId?: string;
}

export function createInitialExperience(sessionId: string): VoyageExperience {
  return {
    sessionId,
    authenticationState: 'anonymous',
    stage: 'intent',
    criteria: {},
    confirmedCriteria: {},
    lockedPreferences: [],
    availableOptions: [],
    evidence: [],
    compareOptionIds: [],
  };
}
