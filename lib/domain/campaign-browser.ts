// Entry point for epic3/web/campaign-calc.js (built by scripts/build-campaign-calc.mjs).
// It runs the server's own campaign calculation in the browser so edits recalculate
// without a round trip. Saving still goes through the server, which recalculates.
import { calculate } from './campaigns';
import { campaignClient } from './campaign-client';
import { load } from './catalogs.browser';
import { InputError, type Data } from './types';
(globalThis as Data).FinalForeCampaign={
  load,
  /** Mirrors POST /api/campaign/preview: a result, or the same message the server would return. */
  preview(details:Data,clients:Data[]){
    try{return {ok:true,result:JSON.parse(JSON.stringify(calculate(campaignClient(details,{clients}))))};}
    catch(error){if(error instanceof InputError)return {ok:false,message:error.message};throw error;}
  },
};
