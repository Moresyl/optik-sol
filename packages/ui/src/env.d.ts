/// <reference types="vite/client" />

/** UnoCSS 产物以字符串形式注入 Shadow DOM，而不是走 <link>。 */
declare module '*.css?inline' {
  const content: string;
  export default content;
}
