import { researchPageWorkspace } from '../page-workspace';
import TemplateEditor from '../_components/TemplateEditor';
export default async function TemplatesPage(){return <TemplateEditor workspace={await researchPageWorkspace()}/>;}
