import { researchPageWorkspace } from '../page-workspace';
import RepSelector from '../_components/RepSelector';
export default async function NewResearchPage(){return <RepSelector workspace={await researchPageWorkspace()}/>;}
