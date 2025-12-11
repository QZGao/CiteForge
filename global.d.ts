// global.d.ts at package root - allow importing CSS and Vue template files as strings
declare module '*.css' {
    const content: string;
    export default content;
}

declare module '*.vue' {
    const template: string;
    export default template;
}