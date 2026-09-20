declare module "*.css?raw" {
  const cssText: string;
  export default cssText;
}

declare module "*.html?raw" {
  const htmlText: string;
  export default htmlText;
}
