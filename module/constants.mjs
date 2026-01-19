export const MODULE_ID = "tcr-main-module";
export const MAIN_HUD_KEY = `${MODULE_ID}.MainHud`;
export const USER_FLAGS = {
  ISSUE_VOTES: "issueVotes",
};
export const SETTINGS = {
  TAB_CONFIGURATION: "tabConfiguration",
  SOURCES_CONFIGURATION: "sourcesConfiguration",
};
export const ISSUE_TYPES = {
  bug: {
    label: "Bug",
    key: "bug",
    iconClass: "fa-bug",
    color: "rgb(241, 91, 80)",
  },
  task: {
    label: "Task",
    key: "task",
    iconClass: "fa-square-check",
    color: "rgb(70, 136, 236)",
  },
  suggestion: {
    label: "Suggestion",
    key: "suggestion",
    iconClass: "fa-lightbulb",
    color: "rgb(179, 134, 0)",
  },
  question: {
    label: "Question",
    key: "question",
    iconClass: "fa-question",
    color: "rgb(224, 108, 0)",
  },
  gameRequest: {
    label: "Game Request",
    key: "gameRequest",
    iconClass: "fa-gamepad",
    color: "rgb(191, 99, 243)",
  },
};
export const PRIORITY = {
  lowest: {
    label: "Lowest",
    key: "lowest",
    iconClass: "fa-chevrons-down",
    color: "rgb(241, 91, 80)",
  },
  low: {
    label: "Low",
    key: "low",
    iconClass: "fa-chevron-down",
    color: "rgb(241, 91, 80)",
  },
  medium: {
    label: "Medium",
    key: "medium",
    iconClass: "fa-equals",
    color: "rgb(224, 108, 0)",
  },
  high: {
    label: "High",
    key: "high",
    iconClass: "fa-chevron-up",
    color: "rgb(70, 136, 236)",
  },
  highest: {
    label: "Highest",
    key: "highest",
    iconClass: "fa-chevrons-up",
    color: "rgb(70, 136, 236)",
  },
};
export const ISSUE_STATUSES = {
  unread: {
    label: "Unread",
    key: "unread",
    iconClass: "fa-solid fa-envelope",
    color: "#3498db",
  },
  read: {
    label: "Read",
    key: "read",
    iconClass: "fa-regular fa-envelope-open",
    color: "#95a5a6",
  },
  inProgress: {
    label: "In-Pogress",
    key: "inProgress",
    iconClass: "fa-solid fa-spinner fa-spin",
    color: "#f1c40f",
  },
  complete: {
    label: "Complete",
    key: "complete",
    iconClass: "fa-solid fa-circle-check",
    color: "#2ecc71",
  },
};

export const BASE_URL = "http://localhost:3001/api/issues";
