import { legacyAsset } from '@/lib/legacy-pages';

/** Use the same navigation markup and responsive sizing as the existing app. */
export default async function AppSidebar({current='research'}: {current?:'research'|'campaign'} = {}){
  const {content}=await legacyAsset('campaign.html');
  const styles=content.match(/<style id="workbook-navigation-styles">([\s\S]*?)<\/style>/)?.[1];
  const footer=content.match(/<footer>([\s\S]*?)<\/footer>/)?.[1];
  if(!styles||!footer)throw new Error('The shared application navigation is missing.');
  const activeLink = current === 'campaign' ? 'data-tab="campaign"' : 'href="/research/new"';
  const navigation=footer.replace(/ aria-current="page"/g,'')
    .replace(activeLink, activeLink + ' aria-current="page"')
    .replace(/<div class="workbook-status">[\s\S]*?<\/div>/,'');
  return <><style dangerouslySetInnerHTML={{__html:styles}}/><footer dangerouslySetInnerHTML={{__html:navigation}}/></>;
}
