export type GrokScope = "PROJECT" | "APPLICATION" | "REALITY";

export type IntentType =
  | "QUESTION"
  | "PROJECT_QUERY"
  | "PROJECT_EDIT"
  | "APPLICATION_QUERY"
  | "APPLICATION_EDIT"
  | "REALITY_QUERY"
  | "REALITY_EDIT"
  | "ENGINEERING_ANALYSIS"
  | "SEARCH"
  | "AMBIGUOUS";

export interface IntentResult {
  type: IntentType;
  scope: GrokScope;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  clarify?: string;
}

const APP_EDIT =
  /чат|панел|кнопк|интерфейс|layout|ui|переимен|сверн|перенес(и|ти) (эту )?кнопк|мне не нравит|сделай чат|эту панель|форму — переделай|добавь новую функцию|application edit|интерфейс/i;
const APP_QUERY = /где чат|почему так выглядит|расположен(ие)? чата|эта панель слишком/i;
const REALITY_EDIT =
  /добав(ь|те) (найденн|эту балку|балку|колонн)|как на фото|перенес(и|ти) шахту|фактическ|as-built|подтверд/i;
const REALITY_QUERY =
  /фото|видео|съёмк|съемк|объект(е|а)? реал|сопостав|маркер|контролн|reality|as-built|as-designed|вот фото/i;
const PROJECT_EDIT =
  /постав(ь|ьте)|увелич|уменьш|передвинь|добав(ь|те) (второй )?вентилятор|разверн|оптимизир|достич|довест|измени|сделай проём|проем/i;
const PROJECT_QUERY =
  /почему только|почему тут|хватит ли|что ограничи|узк(ое|им) мест|safe|запрошено|bottleneck|разбор/i;
const ANALYSIS = /проверь (мой )?проект|критик|challenge|симуляц|отказ вентилятор|грязн(ый|ый) фильтр|failure/i;

export function routeIntent(message: string, ctx?: { hasPhotos?: boolean; pickedUi?: boolean }): IntentResult {
  const s = message.trim();
  if (!s) return { type: "AMBIGUOUS", scope: "PROJECT", confidence: "LOW", clarify: "Что сделать с проектом, приложением или фото объекта?" };

  if (ctx?.pickedUi || APP_EDIT.test(s)) {
    return { type: "APPLICATION_EDIT", scope: "APPLICATION", confidence: ctx?.pickedUi ? "HIGH" : "MEDIUM" };
  }
  if (APP_QUERY.test(s)) return { type: "APPLICATION_QUERY", scope: "APPLICATION", confidence: "HIGH" };
  if (ctx?.hasPhotos && REALITY_EDIT.test(s)) return { type: "REALITY_EDIT", scope: "REALITY", confidence: "HIGH" };
  if (ctx?.hasPhotos || REALITY_QUERY.test(s)) {
    if (REALITY_EDIT.test(s)) return { type: "REALITY_EDIT", scope: "REALITY", confidence: "MEDIUM" };
    return { type: "REALITY_QUERY", scope: "REALITY", confidence: ctx?.hasPhotos ? "HIGH" : "MEDIUM" };
  }
  if (ANALYSIS.test(s)) return { type: "ENGINEERING_ANALYSIS", scope: "PROJECT", confidence: "HIGH" };
  if (PROJECT_EDIT.test(s)) return { type: "PROJECT_EDIT", scope: "PROJECT", confidence: "HIGH" };
  if (PROJECT_QUERY.test(s)) return { type: "PROJECT_QUERY", scope: "PROJECT", confidence: "HIGH" };
  if (/\?$/.test(s) || /почему|как |что |сколько/i.test(s)) {
    return { type: "QUESTION", scope: "PROJECT", confidence: "MEDIUM" };
  }
  if (PROJECT_EDIT.test(s) && APP_EDIT.test(s)) {
    return { type: "AMBIGUOUS", scope: "PROJECT", confidence: "LOW", clarify: "Изменить проект фермы или интерфейс MINEFORGE?" };
  }
  return { type: "QUESTION", scope: "PROJECT", confidence: "LOW" };
}
