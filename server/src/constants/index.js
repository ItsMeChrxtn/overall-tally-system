export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  EVENT_ADMIN: 'event_admin',
  JUDGE: 'judge',
  TABULATOR: 'tabulator',
});
export const ROLE_LIST = Object.values(ROLES);

/** Roles that can be attached to an event through an EventAssignment. */
export const ASSIGNMENT_ROLES = [ROLES.EVENT_ADMIN, ROLES.TABULATOR, ROLES.JUDGE];

export const USER_STATUS = ['active', 'inactive'];

export const EVENT_TYPES = ['pageant', 'dance', 'singing', 'sports', 'academic', 'talent', 'school', 'other'];

export const EVENT_STATUSES = [
  'draft',
  'upcoming',
  'active',
  'scoring',
  'for_verification',
  'for_approval',
  'published',
  'completed',
  'archived',
];

export const CATEGORY_STATUS = ['setup', 'scoring', 'closed'];

export const SCORING_METHODS = ['total', 'average', 'weighted', 'rank', 'custom'];
export const CUSTOM_STRATEGIES = ['trimmed_mean', 'rank_of_scores'];

export const TIE_RULES = ['highest_weight_criterion', 'criterion', 'judge', 'shared'];

export const OVERALL_METHODS = ['weighted', 'rank_sum'];

export const CONTESTANT_STATUS = ['active', 'withdrawn', 'disqualified'];

export const SHEET_STATUS = ['draft', 'submitted', 'reopened'];

export const RESULT_STATUS = ['preliminary', 'for_approval', 'approved', 'returned', 'published', 'superseded'];
/** Result states that "hold" a category: no new versions or score corrections until it is returned/unpublished. */
export const RESULT_LOCKING_STATUSES = ['for_approval', 'approved', 'published'];
