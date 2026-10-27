import { signupClosed } from "@/kernel/auth/signup";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return <LoginForm signupOpen={!signupClosed()} />;
}
