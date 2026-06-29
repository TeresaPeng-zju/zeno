import { getRequestConfig } from "next-intl/server";

import { getUserLocale } from "./locale";
import { defaultLocale } from "./config";

type Dict = { [k: string]: string | string[] | Dict };

/** 深合并：以 base(默认语言) 兜底，locale 覆盖；任何缺失键回退到默认语言而非显示 raw key。 */
function deepMerge(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const k of Object.keys(over)) {
    const b = base[k];
    const o = over[k];
    out[k] = b && o && typeof b === "object" && !Array.isArray(b) && typeof o === "object" && !Array.isArray(o)
      ? deepMerge(b as Dict, o as Dict)
      : o;
  }
  return out;
}

export default getRequestConfig(async () => {
  const locale = await getUserLocale();
  const base = (await import(`../messages/${defaultLocale}.json`)).default as Dict;

  let messages: Dict = base;
  if (locale !== defaultLocale) {
    try {
      const loc = (await import(`../messages/${locale}.json`)).default as Dict;
      messages = deepMerge(base, loc); // 缺失键自动回退到默认语言
    } catch {
      messages = base; // 语言文件缺失也不崩，退回默认语言
    }
  }

  return { locale, messages };
});
