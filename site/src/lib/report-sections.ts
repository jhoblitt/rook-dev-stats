// The sections of the report a link may name, in the page's order: the name
// the address carries, read from the heading a reader sees, and the id of the
// element it names, which other code and the methods page already use.

export interface ReportSection {
  name: string;
  id: string;
  title: string;
}

export const REPORT_SECTIONS: readonly ReportSection[] = [
  { name: 'velocity', id: 'velocity', title: 'Velocity' },
  { name: 'review', id: 'review', title: 'Review' },
  { name: 'ai-use', id: 'llm', title: 'AI use' },
  { name: 'each-pr', id: 'dots', title: 'Each PR' },
  { name: 'timelines', id: 'timelines', title: 'Timelines' },
  { name: 'pull-requests', id: 'table', title: 'Pull requests' },
  { name: 'people', id: 'people', title: 'People' },
];

export function reportSection(name: string): ReportSection | undefined {
  return REPORT_SECTIONS.find((s) => s.name === name);
}
