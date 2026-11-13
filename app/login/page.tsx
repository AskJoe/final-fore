import { signIn } from './actions';
import './style.css';
export const dynamic='force-dynamic';
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {error}=await searchParams;
  return <main className="login">
    <div className="login-brand"><img src="/brand/final-fore-media.png" alt="Final Fore Media" width="1080" height="242" /></div>
    <div className="login-content">
      <h1>Sign in</h1><p>Access your media plans, orders, and reports.</p>
      {error&&<p role="alert" className="error">{error}</p>}
      <form action={signIn}><label>Email<input name="email" type="email" autoComplete="username" required maxLength={320}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024}/></label><button type="submit">Sign in</button></form>
      <p className="hint">Access is limited to approved accounts.</p>
    </div>
  </main>;
}
