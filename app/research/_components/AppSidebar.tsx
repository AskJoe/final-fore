import { legacyAsset } from '@/lib/legacy-pages';

/** Use the same navigation markup and responsive sizing as the existing app. */
export default async function AppSidebar(){
  const {content}=await legacyAsset('campaign.html');
  const styles=content.match(/<style id="workbook-navigation-styles">([\s\S]*?)<\/style>/)?.[1];
  const footer=content.match(/<footer>([\s\S]*?)<\/footer>/)?.[1];
  if(!styles||!footer)throw new Error('The shared application navigation is missing.');
  const navigation=footer.replace(/ aria-current="page"/g,'')
    .replace('href="/research/new"','href="/research/new" aria-current="page"')
    .replace(/<div class="workbook-status">[\s\S]*?<\/div>/,'');
  return <><style dangerouslySetInnerHTML={{__html:styles}}/><footer className="research-sidebar" dangerouslySetInnerHTML={{__html:navigation}}/></>;
}
