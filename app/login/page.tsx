import { signIn } from './actions';
import './style.css';
export const dynamic='force-dynamic';
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {error}=await searchParams;
  return <main className="login"><div className="brand">ff</div><h1>Final Fore</h1><p>Sign in to your media plans, orders, and reports.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    <form action={signIn}><label>Email<input name="email" type="email" autoComplete="username" required maxLength={320}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024}/></label><button type="submit">Sign in</button></form>
    <p className="hint">Access is limited to approved accounts.</p></main>;
}
