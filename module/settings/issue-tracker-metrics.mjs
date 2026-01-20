import { MODULE_ID, SETTINGS } from "../constants.mjs";
import JiraIssueManager from "../jira/jira-manager.mjs";

export default function registerMetricsSetting() {
  game.settings.register(MODULE_ID, SETTINGS.METRICS_TIME_VALUE, {
    name: "Time Span Number",
    hint: "The number of units for the threshold box on Issue Tracker.",
    scope: "world",
    config: true,
    type: Number,
    default: 7,
    onChange: () => JiraIssueManager.instance.loadMetrics(),
  });

  game.settings.register(MODULE_ID, SETTINGS.METRICS_TIME_UNIT, {
    name: "Time Span Unit",
    hint: "Choose the unit of time for the threshold box on Issue Tracker.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "days": "Days",
      "weeks": "Weeks",
      "months": "Months",
      "years": "Years"
    },
    default: "days",
    onChange: () => JiraIssueManager.instance.loadMetrics()
  });
}