import { createContext, useContext } from "react";

/** 当前工作面的唯一搜索源；路由间各自保留搜索词。 */
export const PageSearchContext = createContext({ query: "", setQuery: (_value: string) => {} });
export const usePageSearch = () => useContext(PageSearchContext);
