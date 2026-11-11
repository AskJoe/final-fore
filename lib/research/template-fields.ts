import type { TemplateDraft } from './types';
export const fieldLabels:Record<string,string>={deadline:'Due date',client:'Client',campaign_year:'Campaign year',sender_name:'Sender name',sender_title:'Sender title',sender_email:'Sender email',flight_dates:'Flight dates',radio_trender_books:'Radio trender books',ranker_books:'Ranker books',tv_books:'TV books',avail_book:'Availability book'};
export function usesField(template:TemplateDraft,key:string){return Object.hasOwn(template.defaults,key)&&(template.subject+'\n'+template.body).includes('{{'+key+'}}');}
