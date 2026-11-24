import type { Intensity, Standard } from "./types.ts";

// ---------------------------------------------------------------------------
// Rule model
// Every rule has a stable id (also the only thing D1 feedback may reference),
// a minimum intensity, a prior confidence (0..1) and a version it was added in.
// Replacements are context-aware: guards see the surrounding sentence.
// ---------------------------------------------------------------------------

export type Category =
  | "grammar" | "convention" | "redundancy" | "wordiness" | "formalism"
  | "transition" | "cliche" | "spelling" | "style" | "phrase";

export interface Ctx {
  matched: string;
  before: string;
  after: string;
  atStart: boolean;
  prev: string;   // previous word in the same clause ("" after punctuation)
  next: string;   // next word ("" if punctuation follows)
  standard: Standard;
  intensity: Intensity;
  apos: string;
}

export type ToFn = (g: string[], c: Ctx) => string | null | undefined;
export type To = string | string[] | ToFn | null;
export type PerStandard = Partial<Record<Standard, To>> & { default: To };

export interface Variant { re: RegExp; to: To | PerStandard; guard?: (c: Ctx) => boolean }

export interface Rule {
  id: string;
  category: Category;
  intensity: Intensity;
  confidence: number;
  since: number;
  phase: 1 | 2 | 3 | 4 | 5;
  only?: Standard[];
  not?: Standard[];
  group?: string;
  variants: Variant[];
}

const ALL_FIL: Standard[] = ["filipino-basic", "filipino-conversational", "filipino-academic", "filipino-professional"];
const PLAIN: Standard[] = ["filipino-basic", "filipino-conversational", "natural-global"];
const FORMAL: Standard[] = ["filipino-academic", "filipino-professional"];

/** Build a case-insensitive phrase regex: spaces match any whitespace; may contain groups/alternation. */
const W = (s: string) => new RegExp(`\\b(?:${s.replace(/ /g, "\\s+")})\\b`, "gi");
const v = (re: RegExp, to: To | PerStandard, guard?: (c: Ctx) => boolean): Variant => ({ re, to, guard });
const lc = (s: string) => s.toLowerCase();

const DET = new Set(["a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their", "some", "any", "all", "no", "more", "each", "every", "such"]);
const MODAL_PREV = new Set(["to", "will", "would", "can", "could", "should", "may", "might", "must", "shall", "do", "does", "did", "not", "we", "i", "you", "they", "who", "which", "that", "please", "and", "or", "also", "then", "let", "kindly", "just", "always", "often", "usually", "to"]);
const looksPlural = (w: string) => /^[a-z-]{3,}s$/.test(w) && !/(ss|us|is|ous|ness)$/.test(w) || /^(?:people|children|men|women|data|students)$/.test(w);
const nextPlural = (c: Ctx) => looksPlural(c.next);
const startsOrAfterSemi = (c: Ctx) => c.atStart || /;\s*$/.test(c.before);
const punctNext = (c: Ctx) => /^\s*(?:[.!?,;:)]|$)/.test(c.after);

export const RULES: Rule[] = [];
function add(id: string, category: Category, intensity: Intensity, confidence: number, phase: Rule["phase"], variants: Variant[], o: Partial<Pick<Rule, "only" | "not" | "group">> = {}) {
  if (RULES.some(r => r.id === id)) throw new Error(`duplicate rule id ${id}`);
  RULES.push({ id, category, intensity, confidence, since: 1, phase, variants, ...o });
}

// ============================ PHASE 1 — grammar ============================
add("grammar-modal-of", "grammar", "light", 0.98, 1, [
  v(W("(should|could|would|must|might) of"), g => `${g[0]} have`, c => c.next !== "course")
]);
add("grammar-then-than", "grammar", "light", 0.9, 1, [
  v(W("(more|less|better|worse|rather|other|greater|smaller|larger|higher|lower|bigger|faster|slower|easier|harder|older|younger) then"), g => `${g[0]} than`)
]);
const PLURAL_Q = "(?=(?:many|several|few|a few|two|three|four|five|six|seven|eight|nine|ten|various|numerous|multiple|hundreds of|thousands of|dozens of|a number of)\\b)";
add("grammar-agreement", "grammar", "light", 0.9, 1, [
  v(new RegExp(`\\bthere\\s+(is|was|has been)\\s+${PLURAL_Q}`, "gi"), g => `there ${/^is$/i.test(g[0]) ? "are" : /^was$/i.test(g[0]) ? "were" : "have been"} `),
  v(new RegExp(`\\bthere['’]s\\s+${PLURAL_Q}`, "gi"), "there are ", c => c.standard !== "filipino-conversational"),
  v(W("(they|we|you) was"), g => `${g[0]} were`),
  v(W("(they|we) is"), g => `${g[0]} are`),
  v(W("(people|children) (is|was)"), g => `${g[0]} ${/^is$/i.test(g[1]) ? "are" : "were"}`),
  v(W("(he|she|it) (don['’]t|do|have)"), (g, c) => {
    const f = lc(g[1]); const fix = f === "do" ? "does" : f === "have" ? "has" : `doesn${c.apos}t`;
    return `${g[0]} ${fix}`;
  }, c => c.atStart || c.prev === "" || ["and", "but", "or", "because", "since", "so", "while", "although", "though", "that"].includes(c.prev))
]);
add("grammar-pronoun-i", "grammar", "light", 0.95, 1, [
  v(/(?<=^|[\s"“‘(])i(?=['’](?:m|ll|ve|d)\b|[\s,;!?]|$)/g, "I",
    c => !/^(?:in|[=+\-*/<>^%(){}\[\]]|\d)/.test(c.after.trim()) && !["for", "let", "int", "var", "chapter", "section", "figure", "table", "item", "point", "step"].includes(c.prev))
]);
add("grammar-capitalize-start", "grammar", "light", 0.9, 1, [
  v(/^(["“'‘(\[]*)([a-z])(?=[a-z]+\b)/g, g => g[0] + g[1].toUpperCase())
]);
const TYPOS: Record<string, string> = {
  alot: "a lot", irregardless: "regardless", definately: "definitely", definitly: "definitely", seperate: "separate",
  seperated: "separated", seperately: "separately", recieve: "receive", recieved: "received", recieves: "receives",
  occured: "occurred", occuring: "occurring", untill: "until", adress: "address", accomodate: "accommodate",
  begining: "beginning", beleive: "believe", wich: "which", thier: "their", teh: "the", tommorow: "tomorrow",
  tomorow: "tomorrow", enviroment: "environment", goverment: "government", neccessary: "necessary",
  necesary: "necessary", sucessful: "successful", occassion: "occasion", commited: "committed", existance: "existence",
  independant: "independent", knowlege: "knowledge", refered: "referred", writting: "writing", foward: "forward",
  wierd: "weird", acheive: "achieve", calender: "calendar", embarass: "embarrass", grammer: "grammar"
};
add("spelling-typos", "grammar", "light", 0.97, 1, [
  v(W(Object.keys(TYPOS).join("|")), (_g, c) => TYPOS[lc(c.matched)])
]);
const DUP_OK = new Set(["that", "had", "bye", "no", "yes", "so", "very", "ha", "well", "knock", "night", "blah", "boo", "pom", "tut", "mama", "papa", "mga", "ang", "po", "na"]);
add("grammar-duplicate-word", "grammar", "light", 0.93, 1, [
  v(/\b([A-Za-z]{2,})[ \t]+\1\b/gi, g => g[0], c => !DUP_OK.has(lc(c.matched.split(/\s+/)[0])))
]);

// ================== PHASE 2 — Filipino English conventions ==================
// These fix constructions that are widely treated as nonstandard even in Philippine English.
// Legitimate Philippine English (e.g. "kindly", "comfort room", "for a while", Filipino particles
// such as "po") is never touched, and no Filipino/Taglish words are ever inserted.
add("fil-discuss-about", "convention", "light", 0.95, 2, [v(W("(discuss|discusses|discussed|discussing) about"), g => g[0])]);
add("fil-mention-about", "convention", "light", 0.95, 2, [v(W("(mention|mentions|mentioned|mentioning) about"), g => g[0])]);
add("fil-emphasize-on", "convention", "light", 0.93, 2, [v(W("(emphasi[sz]e|emphasi[sz]es|emphasi[sz]ed|emphasi[sz]ing) on"), g => g[0])]);
add("fil-cope-up", "convention", "light", 0.95, 2, [v(W("(cope|copes|coped|coping) up with"), g => `${g[0]} with`)]);
add("fil-can-able", "convention", "light", 0.95, 2, [v(W("can able to"), "can")]);
add("fil-more-better", "convention", "light", 0.95, 2, [v(W("more (better|faster|easier|bigger|smaller|cheaper|larger|higher|lower|stronger|longer|shorter|worse)"), g => g[0])]);
add("fil-return-back", "convention", "light", 0.9, 2, [
  v(W("(return|returns|returned|returning|revert|reverts|reverted|reverting|reply|replies|replied|replying) back"), g => g[0]),
  v(W("(repeat|repeats|repeated|repeating) again"), g => g[0])
]);
add("fil-reason-because", "convention", "light", 0.9, 2, [v(W("(reason (?:is|was|being)) because"), g => `${g[0]} that`)]);
add("fil-attend-to", "convention", "light", 0.9, 2, [
  v(W("attend to ((?:the|a|an|our|my|your|their|his|her|this|that|these|those) (?:meetings?|class(?:es)?|seminars?|conferences?|webinars?|events?|trainings?|workshops?|sessions?|parties|party|weddings?|funerals?|lectures?|orientations?|ceremon(?:y|ies)|hearings?))"), g => `attend ${g[0]}`)
]);
add("fil-uncountable-plurals", "convention", "light", 0.9, 2, [
  v(W("(informations|advices|equipments|furnitures|feedbacks|knowledges|luggages|baggages|homeworks)"), g => g[0].replace(/s$/i, "")),
  v(W("stuffs"), "stuff", c => DET.has(c.prev) || ["many", "other", "of", "these", "those", "some", "such", "all"].includes(c.prev))
]);
const GERUND: Record<string, string> = { hear: "hearing", see: "seeing", meet: "meeting", work: "working", receive: "receiving", get: "getting", have: "having", read: "reading", talk: "talking", speak: "speaking", discuss: "discussing", join: "joining", help: "helping", collaborate: "collaborating", connect: "connecting", visit: "visiting", attend: "attending" };
const AMBIG = new Set(["work", "talk", "help", "visit", "join", "speak", "connect", "collaborate"]);
add("fil-looking-forward-to", "convention", "light", 0.9, 2, [
  v(W(`(looking|look|looks|looked) forward to (${Object.keys(GERUND).join("|")})`), g => `${g[0]} forward to ${GERUND[lc(g[1])]}`,
    c => { const verb = lc(c.matched.split(/\s+/).pop() ?? ""); return !AMBIG.has(verb) || /^(?:with|you|your|the|our|us|them|together|on|a|an|my|his|her|their)$/.test(c.next); })
]);
add("fil-according-to-me", "convention", "balanced", 0.9, 2, [
  v(W("according to me|based on my opinion|in my personal opinion"), { default: "in my opinion", "filipino-academic": "in my view" })
]);
add("fil-as-per", "convention", "balanced", 0.8, 2, [v(W("as per"), "according to", c => c.next !== "usual")], { not: ["filipino-professional"] });
add("fil-please-be-advised", "convention", "balanced", 0.8, 2, [
  v(W("please be (?:informed|advised) that"), { default: "please note that", "filipino-conversational": "just so you know," })
]);
add("fil-would-like-to-inform", "convention", "strong", 0.75, 2, [
  v(W("i would like to (?:inform|advise) you that"), "I would like to let you know that")
]);
add("fil-revert-to-me", "convention", "balanced", 0.8, 2, [
  v(W("revert (?:back )?to (me|us)"), g => `reply to ${g[0]}`),
  v(W("(kindly|please) revert(?: back)?"), g => `${g[0]} reply`, c => /^\s*(?:[.!?,]|$|(?:as|at|by|within|before|on|with|soon|asap)\b)/i.test(c.after))
]);

// ======================= PHASE 2 — redundancy ==============================
add("redundancy-doublets", "redundancy", "balanced", 0.85, 2, [
  v(W("each and every"), "every"), v(W("first and foremost"), "first"), v(W("any and all"), "all"),
  v(W("various different"), "different"), v(W("(?:very|most|quite|really|extremely|more) unique"), "unique"),
  v(W("(?:completely|totally|entirely) (eliminate|eliminated|eliminates|eliminating|destroy|destroyed|destroys)"), g => g[0])
]);
add("redundancy-modifiers", "redundancy", "balanced", 0.85, 2, [
  v(W("advance planning"), "planning"), v(W("past history"), "history"), v(W("end result"), "result"),
  v(W("final outcome"), "outcome"), v(W("close proximity"), "proximity"), v(W("free gift"), "gift"),
  v(W("basic fundamentals"), "fundamentals"), v(W("added bonus"), "bonus"), v(W("true fact"), "fact"),
  v(W("unexpected surprise"), "surprise"), v(W("absolutely essential"), "essential"),
  v(W("(join|joins|joined|joining|merge|merges|merged|merging|combine|combines|combined|combining) together"), g => g[0])
]);

// ================= PHASE 3 — wordiness / phrasing =========================
add("phrase-it-is-important-to-note", "wordiness", "balanced", 0.85, 3, [
  // After a sentence-opening phrase ("Furthermore, ..." / "In today's world, ...") the filler is simply
  // dropped so the sentence does not stack two introductory phrases.
  v(W("it is important to note that|it should be noted that"), "", c => /^\s*[^,.;:]{1,60},\s*$/.test(c.before)),
  v(W("it is important to note that|it should be noted that"), {
    default: "notably,", "filipino-basic": "it is worth noting that", "filipino-academic": "it is worth noting that"
  })
]);
add("phrase-in-order-to", "wordiness", "light", 0.97, 3, [
  v(W("in order to"), "to"),
  v(W("so as to"), "to", c => c.prev !== "not")
]);
add("phrase-due-to-the-fact", "wordiness", "balanced", 0.92, 3, [
  v(W("due to the fact that|owing to the fact that|on account of the fact that|in view of the fact that"), "because")
]);
add("phrase-in-spite-of-the-fact", "wordiness", "balanced", 0.9, 3, [
  v(W("in spite of the fact that|despite the fact that|regardless of the fact that"), "although")
]);
add("phrase-a-wide-range-of", "wordiness", "strong", 0.8, 3, [
  v(W("a wide range of|a broad range of|a wide variety of"), { default: "many", "filipino-academic": "a range of" }, nextPlural),
  v(W("a large number of|a great number of|a huge number of|a multitude of|a plethora of"), "many", nextPlural),
  v(W("a variety of"), "various", nextPlural)
]);
add("phrase-a-number-of", "wordiness", "balanced", 0.8, 3, [v(W("a number of"), "several", nextPlural)]);
add("phrase-the-majority-of", "wordiness", "balanced", 0.85, 3, [
  v(W("the (?:vast )?majority of (?=(?:the|these|those|his|her|their|our|my|your)\\b)"), "most of "),
  v(W("the (?:vast )?majority of"), "most", nextPlural)
]);
add("phrase-the-reason-why", "wordiness", "balanced", 0.85, 3, [v(W("the reason why"), "the reason")]);
add("phrase-and-also", "wordiness", "balanced", 0.8, 3, [v(W("and also"), "and", c => c.prev !== "only" && !/^\s*,/.test(c.after))]);
add("phrase-utilize", "formalism", "balanced", 0.93, 3, [
  v(W("utili[sz]e|utili[sz]es"), (_g, c) => c.matched.toLowerCase().endsWith("s") ? "uses" : "use"),
  v(W("utili[sz]ed"), "used"), v(W("utili[sz]ing"), "using"), v(W("utili[sz]ation"), "use")
]);
add("phrase-make-use-of", "wordiness", "balanced", 0.9, 3, [
  v(W("(make|makes|made|making) use of"), g => ({ make: "use", makes: "uses", made: "used", making: "using" } as Record<string, string>)[lc(g[0])])
]);
add("phrase-approximately", "formalism", "strong", 0.85, 3, [
  v(W("approximately"), { default: "about", "filipino-academic": null, "filipino-professional": null },
    c => /^\s*(?:[$₱€£]|\d|(?:one|two|three|four|five|six|seven|eight|nine|ten|half|a|an)\b)/i.test(c.after))
]);
add("phrase-in-the-event-that", "wordiness", "balanced", 0.92, 3, [v(W("in the event that|in the event of the fact that"), "if")]);
add("phrase-for-the-purpose-of", "wordiness", "balanced", 0.85, 3, [
  // "to" + gerund is ungrammatical, so the purpose phrase becomes "for" before an -ing word.
  v(W("for the purpose of"), "for", c => /ing$/.test(c.next))
]);
add("phrase-with-regard-to", "formalism", "strong", 0.85, 3, [
  v(W("with regards? to|in regards? to|with respect to|in relation to"), { default: "as for", "filipino-academic": "regarding", "filipino-professional": "regarding" }, c => c.atStart),
  v(W("with regards? to|in regards? to|with respect to|in relation to"), { default: "about", "filipino-academic": "regarding", "filipino-professional": "regarding" }, c => !c.atStart)
]);
add("phrase-very-important", "phrase", "balanced", 0.85, 3, [
  v(W("of great importance"), "very important", c => /^(?:is|are|was|were|be|been|remains?|seems?|becomes?)$/.test(c.prev))
]);
add("phrase-at-this-point-in-time", "wordiness", "balanced", 0.9, 3, [
  v(W("at this point in time|at the present time|at this moment in time"), { default: "now", "filipino-academic": "currently" })
]);
add("phrase-in-the-near-future", "wordiness", "balanced", 0.85, 3, [v(W("in the near future"), "soon")], { not: ["filipino-academic"] });
add("phrase-on-a-basis", "wordiness", "balanced", 0.9, 3, [
  v(W("on an? (daily|weekly|monthly|yearly)(?: basis)"), g => lc(g[0])),
  v(W("on a regular basis"), "regularly")
]);
add("phrase-has-the-ability-to", "wordiness", "balanced", 0.9, 3, [
  v(W("(?:has|have) the ability to"), "can"), v(W("had the ability to"), "could"),
  v(W("(?:is|are) able to"), "can", c => c.prev !== "not")
]);
const MAKE_FORMS = "(make|makes|made|making)";
const mk = (m: Record<string, string>) => (g: string[]) => m[lc(g[0])];
add("phrase-make-a-decision", "wordiness", "balanced", 0.88, 3, [
  v(W(`${MAKE_FORMS} (?:a|the) decision`), mk({ make: "decide", makes: "decides", made: "decided", making: "deciding" })),
  v(W("(give|gives|gave|giving) consideration to"), mk({ give: "consider", gives: "considers", gave: "considered", giving: "considering" })),
  v(W("(take|takes|took|taking) into consideration"), mk({ take: "consider", takes: "considers", took: "considered", taking: "considering" })),
  v(W("(come|comes|came|coming) to the conclusion that"), mk({ come: "conclude that", comes: "concludes that", came: "concluded that", coming: "concluding that" })),
  v(W("(provide|provides|provided|providing) assistance (?:to|with)"), mk({ provide: "help", provides: "helps", provided: "helped", providing: "helping" }))
]);
add("phrase-in-need-of", "wordiness", "balanced", 0.85, 3, [
  v(W("(is|are) in need of"), g => (lc(g[0]) === "is" ? "needs" : "need"), c => c.prev !== "not")
]);
add("phrase-prior-to", "wordiness", "balanced", 0.9, 3, [v(W("prior to"), "before"), v(W("subsequent to"), "after")], { not: ["filipino-academic"] });
add("phrase-in-the-absence-of", "wordiness", "balanced", 0.85, 3, [v(W("in the absence of"), "without")]);
add("phrase-with-the-exception-of", "wordiness", "balanced", 0.88, 3, [v(W("with the exception of"), "except for")]);
add("phrase-in-an-effort-to", "wordiness", "balanced", 0.85, 3, [v(W("in an effort to"), "to")]);
add("phrase-in-most-cases", "wordiness", "balanced", 0.85, 3, [v(W("in the majority of cases"), "in most cases")]);
add("phrase-personally", "wordiness", "balanced", 0.85, 3, [v(W("i personally (think|believe|feel)"), g => `I ${g[0]}`)]);
add("phrase-as-a-matter-of-fact", "wordiness", "strong", 0.8, 3, [v(W("as a matter of fact"), "in fact")]);
add("phrase-at-the-end-of-the-day", "cliche", "strong", 0.7, 3, [v(W("at the end of the day"), "in the end")], { not: ["filipino-conversational"] });
add("cliche-in-todays-world", "cliche", "balanced", 0.72, 3, [
  v(W("in (?:today['’]s|this) (?:(?:fast-paced|digital|modern|ever-changing|rapidly changing) )?(?:world|society|age|era)|in this day and age"), "today,", c => c.atStart)
]);
add("cliche-delve-into", "cliche", "balanced", 0.85, 3, [
  v(W("(delve|delves|delved|delving) into"), mk({ delve: "look into", delves: "looks into", delved: "looked into", delving: "looking into" }))
]);
add("formal-leverage", "formalism", "strong", 0.8, 3, [
  v(W("leverages"), "uses"), v(W("leveraged"), "used", c => c.next !== "buyout"), v(W("leveraging"), "using"),
  v(W("leverage"), "use", c => MODAL_PREV.has(c.prev))
], { not: ["filipino-academic"] });

// Simple-vocabulary swaps (context-guarded). Formal standards keep the formal word unless noted.
const swap = (id: string, intensity: Intensity, conf: number, forms: Array<[string, string]>, o: Parameters<typeof add>[6] = {}, guard?: (c: Ctx) => boolean) =>
  add(id, "formalism", intensity, conf, 3, forms.map(([a, b]) => v(W(a), b, guard)), o);
swap("formal-commence", "balanced", 0.9, [["commence", "start"], ["commences", "starts"], ["commenced", "started"], ["commencing", "starting"]], { not: ["filipino-academic"] });
swap("formal-terminate", "balanced", 0.8, [["terminate", "end"], ["terminates", "ends"], ["terminated", "ended"], ["terminating", "ending"]], { not: FORMAL },
  c => !/^(?:employment|contract|agreement|lease|account|service|process|program)$/.test(c.next));
// "had obtained" would become the British-only "had got", so participles after have/be are left alone.
swap("formal-obtain", "balanced", 0.85, [["obtain", "get"], ["obtains", "gets"], ["obtained", "got"], ["obtaining", "getting"]], { only: PLAIN },
  c => !/^(?:have|has|had|having|be|been|being|is|are|was|were)$/.test(c.prev));
swap("formal-ascertain", "balanced", 0.85, [["ascertain", "find out"], ["ascertains", "finds out"], ["ascertained", "found out"], ["ascertaining", "finding out"]], { not: ["filipino-academic"] });
swap("formal-endeavor", "balanced", 0.85, [["endeavou?rs?", "try"], ["endeavou?red", "tried"], ["endeavou?ring", "trying"]], { not: ["filipino-academic"] }, c => c.next === "to");
swap("formal-numerous", "balanced", 0.85, [["numerous", "many"]], { only: PLAIN }, c => looksPlural(c.next));
swap("formal-sufficient", "balanced", 0.85, [["sufficient", "enough"]], { only: PLAIN });
swap("formal-subsequently", "balanced", 0.85, [["subsequently", "later"]], { not: ["filipino-academic"] });
swap("formal-demonstrate", "strong", 0.8, [["demonstrates", "shows"], ["demonstrate", "show"], ["demonstrating", "showing"]], { only: PLAIN });
add("formal-demonstrated", "formalism", "strong", 0.8, 3, [
  v(W("demonstrated"), (_g, c) => /(?:\b(?:has|have|had|been|was|were|is|are|be)\s+(?:\w+ly\s+)?)$/i.test(c.before) ? "shown" : "showed")
], { only: PLAIN });
add("formal-purchase", "formalism", "balanced", 0.8, 3, [
  v(W("purchase"), "buy", c => MODAL_PREV.has(c.prev)),
  v(W("purchased"), "bought", c => /^(?:i|we|you|they|he|she|it|who|and|has|have|had)$/.test(c.prev) && !DET.has(c.next)),
  v(W("purchasing"), "buying", c => /^(?:by|after|before|when|while|for|is|are|was|were)$/.test(c.prev) && !/^(?:power|department|manager|agent|order|officer)$/.test(c.next))
], { not: FORMAL });
add("formal-assist", "formalism", "balanced", 0.8, 3, [
  v(W("assist"), "help", c => MODAL_PREV.has(c.prev)), v(W("assists"), "helps"),
  v(W("assisted"), "helped"), v(W("assisting"), "helping"),
  v(W("assistance"), "help", c => !/^(?:financial|legal|medical|technical|public|social|humanitarian|economic|emergency)$/.test(c.prev))
], { only: PLAIN });
add("formal-require", "formalism", "strong", 0.8, 3, [
  v(W("requires"), "needs", c => DET.has(c.next) && c.next !== "that"),
  v(W("require"), "need", c => DET.has(c.next) && /^(?:we|you|they|i|which|who)$/.test(c.prev))
], { only: PLAIN });
add("formal-inform", "formalism", "balanced", 0.8, 3, [
  v(W("(inform|informs|informed|informing) (you|him|her|them|us|me|everyone)"),
    (g) => `${({ inform: "tell", informs: "tells", informed: "told", informing: "telling" } as Record<string, string>)[lc(g[0])]} ${g[1]}`)
], { only: ["filipino-basic", "filipino-conversational"] });

// -------- Transitions: sentence-initial only, rotating so one word is never repeated ---------
const T = (w: string) => new RegExp(`\\b${w}\\b,?`, "gi");
add("transition-furthermore", "transition", "balanced", 0.85, 3, [
  v(T("furthermore"), {
    default: ["also,", "in addition,"], "filipino-basic": ["also,", "in addition,"],
    "filipino-conversational": ["also,", "plus,", "on top of that,"], "filipino-academic": ["in addition,", "additionally,"],
    "filipino-professional": ["in addition,", "also,"]
  }, startsOrAfterSemi)
], { group: "additive" });
add("transition-moreover", "transition", "balanced", 0.85, 3, [
  v(T("moreover"), {
    default: ["also,", "in addition,"], "filipino-basic": ["also,", "in addition,"],
    "filipino-conversational": ["on top of that,", "also,", "what's more,"], "filipino-academic": ["in addition,", "additionally,"],
    "filipino-professional": ["in addition,", "also,"]
  }, startsOrAfterSemi)
], { group: "additive" });
add("transition-additionally", "transition", "balanced", 0.8, 3, [
  v(T("additionally"), { default: ["also,", "in addition,", "on top of that,"], "filipino-conversational": ["also,", "plus,", "on top of that,"], "filipino-academic": null, "filipino-professional": null }, c => c.atStart)
], { group: "additive" });
add("phrase-in-conclusion", "transition", "balanced", 0.85, 3, [
  v(T("in conclusion"), { default: "to sum up,", "filipino-conversational": ["overall,", "all in all,"], "filipino-academic": null, "filipino-professional": "overall," }, c => c.atStart),
  v(T("in summary"), { default: "to sum up,", "filipino-conversational": ["overall,", "all in all,"], "filipino-academic": null, "filipino-professional": null }, c => c.atStart)
], { group: "closing" });
add("transition-consequently", "transition", "balanced", 0.85, 3, [
  v(T("consequently|therefore|thus|hence"), { default: ["so,", "as a result,"], "filipino-academic": null, "filipino-professional": ["as a result,", "so,"] }, c => c.atStart)
], { group: "causal", not: ["filipino-academic"] });
add("transition-nevertheless", "transition", "balanced", 0.8, 3, [
  v(T("nevertheless|nonetheless"), { default: ["even so,", "still,"], "filipino-academic": null }, c => c.atStart)
], { group: "contrast" });

// ================ PHASE 4 — spelling & register (contractions) =============
const BRIT: Array<[string, string]> = [
  ["centre", "center"], ["centres", "centers"], ["metre", "meter"], ["metres", "meters"], ["litre", "liter"], ["litres", "liters"],
  ["kilometre", "kilometer"], ["kilometres", "kilometers"], ["millimetre", "millimeter"], ["centimetre", "centimeter"],
  ["theatre", "theater"], ["theatres", "theaters"], ["fibre", "fiber"], ["calibre", "caliber"],
  ["analyse", "analyze"], ["analyses", "analyzes"], ["analysed", "analyzed"], ["analysing", "analyzing"],
  ["catalogue", "catalog"], ["catalogues", "catalogs"], ["programme", "program"], ["programmes", "programs"],
  ["defence", "defense"], ["offence", "offense"], ["licence", "license"], ["grey", "gray"], ["judgement", "judgment"],
  ["ageing", "aging"], ["learnt", "learned"], ["whilst", "while"], ["amongst", "among"], ["fulfil", "fulfill"],
  ["fulfils", "fulfills"], ["enrol", "enroll"], ["skilful", "skillful"], ["sceptical", "skeptical"],
  ["travelling", "traveling"], ["travelled", "traveled"], ["traveller", "traveler"], ["travellers", "travelers"],
  ["practise", "practice"], ["practised", "practiced"], ["practising", "practicing"], ["tyre", "tire"], ["tyres", "tires"],
  ["aluminium", "aluminum"], ["cosy", "cozy"], ["mould", "mold"], ["maths", "math"]
];
const OUR = "col|fav|hon|behavi|neighb|lab|hum|flav|harb|rum|od|vig|tum";
const ISE = "organ|recogn|real|apolog|critic|emphas|summar|minim|maxim|priorit|util|special|categor|custom|final|author|general|central|normal|modern|mobil|harmon|legal|social|capital|character|civil|familiar|stabil|symbol|synchron|visual|optim|personal|patron|memor|neutral|fertil|global|hospital|industrial|local|popular|rational|revolution|scrutin|sympath|terror|mechan";
const britGuard = (c: Ctx) => c.atStart || !/^[A-Z]/.test(c.matched);
const britMap = new Map(BRIT);
add("spelling-american", "spelling", "light", 0.9, 4, [
  v(W(BRIT.map(p => p[0]).join("|")), (_g, c) => britMap.get(lc(c.matched)), britGuard),
  v(new RegExp(`\\b(${OUR})our(s|ed|ing|ful|less|able|ably|ite|ites|ist|ists|er|ers)?\\b`, "gi"), g => `${g[0]}or${g[1] ?? ""}`, britGuard),
  v(new RegExp(`\\b(${ISE})is(e|es|ed|ing|ation|ations)\\b`, "gi"), g => `${g[0]}iz${g[1]}`, britGuard)
], { only: ALL_FIL });

const AUX = "do|does|did|is|are|was|were|has|have|had|would|could|should";
const NOT_EMPH = /^\s*(?:only\b|just\b|even\b|merely\b|simply\b|necessarily\b|[.!?])/i;
add("style-contract-negations", "style", "balanced", 0.82, 4, [
  v(W(`(${AUX}) not`), (g, c) => `${g[0]}n${c.apos}t`, c => !NOT_EMPH.test(c.after)),
  v(W("will not"), (_g, c) => `won${c.apos}t`, c => !NOT_EMPH.test(c.after)),
  v(W("can(?:\\s+not|not)"), (_g, c) => `can${c.apos}t`, c => !NOT_EMPH.test(c.after))
], { only: ["filipino-conversational"] });
add("style-contract-pronouns", "style", "balanced", 0.78, 4, [
  v(W("(i) am|(you|we|they) are|(he|she|it|that) is"), (g, c) => {
    const m = lc(c.matched).split(/\s+/); const pro = lc(m[0]); const verb = m[1];
    const suf = verb === "am" ? "m" : verb === "are" ? "re" : "s";
    return `${/^i$/.test(pro) ? "I" : g.find(x => x) ?? pro}${c.apos}${suf}`;
  }, c => !punctNext(c) && !/^\s*not\b/i.test(c.after)),
  v(W("(i|you|we|they|he|she) will"), (g, c) => `${g[0]}${c.apos}ll`, c => !punctNext(c) && !/^\s*not\b/i.test(c.after))
], { only: ["filipino-conversational"] });

const EXPAND: Record<string, string> = {
  "don't": "do not", "doesn't": "does not", "didn't": "did not", "isn't": "is not", "aren't": "are not", "wasn't": "was not",
  "weren't": "were not", "haven't": "have not", "hasn't": "has not", "hadn't": "had not", "wouldn't": "would not",
  "couldn't": "could not", "shouldn't": "should not", "mustn't": "must not", "can't": "cannot", "won't": "will not",
  "i'm": "I am", "you're": "you are", "we're": "we are", "they're": "they are", "i've": "I have", "you've": "you have",
  "we've": "we have", "they've": "they have", "i'll": "I will", "you'll": "you will", "we'll": "we will",
  "they'll": "they will", "he'll": "he will", "she'll": "she will"
};
const PARTICIPLE = /^(?:been|got|gotten|had|done|gone|become|come|taken|made|given|seen|known|shown|begun|\w+ed|\w+en)$/;
add("style-expand-contractions", "style", "balanced", 0.85, 4, [
  v(/\b[A-Za-z]+['’](?:t|m|re|ve|ll)\b/gi, (_g, c) => EXPAND[lc(c.matched).replace(/’/g, "'")] ?? null),
  v(/\b(?:it|that|there|what|here|who|he|she)['’]s\b/gi, (_g, c) => `${c.matched.slice(0, -2)} is`, c => !PARTICIPLE.test(c.next) && c.next !== "")
], { only: ["filipino-academic"] });

// ==================== PHASE 5 — article agreement (last) ===================
const VOWEL_SOUND_H = /^(?:hour|honest|honor|honour|heir)/i;
const CONS_SOUND_V = /^(?:uni(?:form|on|que|t|ty|ted|versal|verse|versity|corn|fication|fied|fy|lateral|sex|code)|use|used|useful|useless|user|usual|usually|usage|usable|utensil|utility|utilit|ubiquit|ukulele|eu[a-z]|one|once|ewe)/i;
add("grammar-a-an", "grammar", "light", 0.93, 5, [
  v(/\b(an?)[ \t]+([A-Za-z][A-Za-z'’-]*)/gi, (g, c) => {
    const art = g[0]; const word = g[1];
    if (/^[A-Z]{2,}$/.test(word) || /^[A-Z][a-z]*[A-Z]/.test(word)) return null; // acronyms / camelCase: unknown pronunciation
    if (c.prev === "(" ) return null;
    const vowel = /^[aeiou]/i.test(word) ? !CONS_SOUND_V.test(word) : VOWEL_SOUND_H.test(word);
    const want = vowel ? "an" : "a";
    if (lc(art) === want) return null;
    return `${want} ${word}`;
  })
]);

// ---------------------------------------------------------------------------
export const RULE_META = new Map(RULES.map(r => [r.id, { category: r.category, intensity: r.intensity, confidence: r.confidence }]));
export const RULE_IDS = new Set(RULE_META.keys());
export const ENGINE_VERSION = 2;

export function ruleCategory(id: string): string {
  return RULE_META.get(id)?.category ?? "wordiness";
}
export function getRules(): Rule[] {
  return RULES;
}
