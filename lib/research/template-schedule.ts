import type { TemplateDraft } from './types';

const sourceSchedule: Record<string, string> = {
  radio_trender_books: 'Feb ’26 through Sept ‘26',
  ranker_books: "Mar ‘26, July '26 AND Sept '26",
  tv_books: 'Mar ’26, Jul ‘26 & Sept ‘26',
  avail_book: 'Mar ‘26',
  flight_dates: 'Feb-May ’27',
};

/** Read older drafts and published versions with their schedule in the email text. */
export function inlineTemplateSchedule<T extends TemplateDraft>(template: T): T {
  const scheduleFields = Object.keys(sourceSchedule);
  if (!scheduleFields.some(key => Object.hasOwn(template.defaults, key)
    || template.subject.includes('{{' + key + '}}') || template.body.includes('{{' + key + '}}'))) {
    return template;
  }

  function inline(text: string) {
    return text.replace(/\{\{([a-z_]+)\}\}/g, (token, key: string) => {
      if (!Object.hasOwn(sourceSchedule, key)) return token;
      return template.defaults[key]?.trim() ? template.defaults[key] : sourceSchedule[key];
    });
  }

  return {
    ...template,
    subject: inline(template.subject),
    body: inline(template.body),
    defaults: Object.fromEntries(
      Object.entries(template.defaults).filter(([key]) => !Object.hasOwn(sourceSchedule, key)),
    ),
  };
}
