import type { IconName } from "../components/Icon";
import type { ActionType, AreaKind, AreaMetrics, Status } from "../types";

/** Worker-facing wording: plain words, English and Hindi side by side. No technical terms. */
export interface TaskInfo {
  icon: IconName;
  status: Status;
  en: { title: string; line: string };
  hi: { title: string; line: string };
}

export const TASKS: Record<ActionType, TaskInfo> = {
  inspection: {
    icon: "inspect",
    status: "red",
    en: { title: "Check this place", line: "Something looks wrong here. Go and look." },
    hi: { title: "यहाँ जाँच करो", line: "यहाँ कुछ गड़बड़ है। जाकर देखो।" },
  },
  pickup: {
    icon: "truck",
    status: "amber",
    en: { title: "Collect dry waste", line: "Dry waste is ready. Take it to the plant." },
    hi: { title: "सूखा कचरा उठाओ", line: "सूखा कचरा तैयार है। प्लांट ले जाओ।" },
  },
  campaign: {
    icon: "teach",
    status: "blue",
    en: { title: "Teach sorting", line: "People are mixing wet and dry waste." },
    hi: { title: "कचरा अलग करना सिखाओ", line: "लोग गीला और सूखा कचरा मिला रहे हैं।" },
  },
  monitor: {
    icon: "eye",
    status: "amber",
    en: { title: "Keep watching", line: "Visit again soon." },
    hi: { title: "नज़र रखो", line: "जल्दी फिर देखो।" },
  },
  none: {
    icon: "check",
    status: "green",
    en: { title: "All good", line: "No work needed here." },
    hi: { title: "सब ठीक है", line: "यहाँ कोई काम नहीं।" },
  },
};

export const TASK_ORDER: ActionType[] = ["inspection", "pickup", "campaign", "monitor", "none"];

export const UI = {
  heading: { en: "Today's work", hi: "आज का काम" },
  sub: { en: "Tap a picture to see the places.", hi: "जगह देखने के लिए तस्वीर दबाओ।" },
  done: { en: "Done", hi: "हो गया" },
  undo: { en: "Undo", hi: "वापस" },
  listen: { en: "Voice note", hi: "आवाज़ सुनो" },
  why: { en: "Why go", hi: "क्यों जाना है" },
  onMap: { en: "See on map", hi: "नक्शा देखो" },
  nothing: { en: "Nothing here. Good work!", hi: "यहाँ कुछ नहीं। बढ़िया काम!" },
};

/** Reads text aloud in Hindi if the browser has a voice for it. Silently does nothing otherwise. */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "hi-IN";
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

export const KIND_LABEL: Record<AreaKind, string> = {
  collection_point: "Collection point",
  transfer_station: "Transfer station",
  colony: "Colony",
};

/** One short reason, from the area's own numbers, saying why the worker should go. */
export function reasonFor(m: AreaMetrics): { en: string; hi: string } {
  const d = Math.round(m.dryFraction * 100);
  const a = Math.round(m.anomalyShare * 100);
  const drop = Math.round(-m.trendDelta * 100);
  switch (m.recommendation.type) {
    case "inspection":
      return {
        en: `${a} out of every 100 checks here look unusual (very wet, or a gas smell). It could be dirt or a metal item.`,
        hi: `यहाँ हर 100 में से ${a} जाँच अजीब मिली है (बहुत गीला या गैस की गंध)। गंदगी या धातु हो सकती है।`,
      };
    case "pickup":
      return {
        en: `${d} out of every 100 items here are dry and clean. The energy plant can use this waste.`,
        hi: `यहाँ हर 100 में से ${d} चीज़ें सूखी और साफ़ हैं। एनर्जी प्लांट इस कचरे का इस्तेमाल कर सकता है।`,
      };
    case "campaign":
      return {
        en: `Only ${d} out of every 100 items here are dry. People are mixing wet and dry waste.`,
        hi: `यहाँ हर 100 में से सिर्फ़ ${d} चीज़ें सूखी हैं। लोग गीला और सूखा कचरा मिला रहे हैं।`,
      };
    case "monitor":
      return m.trendDelta <= -0.05
        ? { en: `Dry waste here is going down (${drop} less in every 100 than before). Check again soon.`, hi: `यहाँ सूखा कचरा घट रहा है (पहले से 100 में ${drop} कम)। जल्दी फिर देखो।` }
        : { en: `A few unusual checks here (${a} in 100). Visit again soon.`, hi: `यहाँ कुछ जाँच अजीब हैं (100 में ${a})। जल्दी फिर देखो।` };
    default:
      return { en: "Everything here looks normal.", hi: "यहाँ सब कुछ सामान्य है।" };
  }
}
