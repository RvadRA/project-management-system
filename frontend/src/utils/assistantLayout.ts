export const assistantDrawerClass = (expanded: boolean): string =>
  `fixed inset-y-0 right-0 h-[100dvh] w-full min-w-0 overflow-hidden ${expanded ? 'md:w-screen md:max-w-none md:rounded-none' : 'md:w-[90vw] md:max-w-[98vw] md:rounded-l-2xl'} bg-slate-950 border-l border-slate-800/80 shadow-2xl flex flex-col`;
