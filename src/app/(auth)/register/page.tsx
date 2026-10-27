import { notFound } from "next/navigation";
import { signupClosed } from "@/kernel/auth/signup";
import { RegisterForm } from "./register-form";

// The box closed (D61 / F105, `AUTH_SIGNUP=closed`): the page does not exist. Better Auth refuses the sign-up
// and the organisation creation behind it as well, so a hand-made request gets the same answer.
export default function RegisterPage() {
  if (signupClosed()) notFound();
  return <RegisterForm />;
}
