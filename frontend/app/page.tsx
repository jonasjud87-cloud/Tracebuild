import AuthHashRedirect from "@/components/auth/AuthHashRedirect";
import SmoothScrollProvider from "@/components/landing/redesign/SmoothScrollProvider";
import IntroOverlay from "@/components/landing/redesign/IntroOverlay";
import AmbientField from "@/components/landing/redesign/AmbientField";
import Navbar from "@/components/landing/redesign/Navbar";
import Hero from "@/components/landing/redesign/Hero";
import ProblemSolution from "@/components/landing/redesign/ProblemSolution";
import HowItWorks from "@/components/landing/redesign/HowItWorks";
import SocialProof from "@/components/landing/redesign/SocialProof";
import Showcase from "@/components/landing/redesign/Showcase";
import TrustBlocks from "@/components/landing/redesign/TrustBlocks";
import Pricing from "@/components/landing/redesign/Pricing";
import TeamContact from "@/components/landing/redesign/TeamContact";
import FinalCta from "@/components/landing/redesign/FinalCta";
import FAQ from "@/components/landing/redesign/FAQ";
import SectionDivider from "@/components/landing/redesign/SectionDivider";
import Footer from "@/components/landing/redesign/Footer";

export default function LandingPage() {
  return (
    <SmoothScrollProvider>
      {/* Fängt Einladungs-/Passwort-Links ab, die Supabase auf die Site-URL
          zurückfallen lässt, und reicht sie an /auth/callback weiter. */}
      <AuthHashRedirect />
      <div className="tb-landing">
        <IntroOverlay />
        <a href="#tb-main" className="tb-skip">Zum Inhalt springen</a>
        <AmbientField />
        <div className="tb-grain" />
        <Navbar />
        <main id="tb-main">
          <Hero />
          <ProblemSolution />
          <SectionDivider />
          <HowItWorks />
          <SocialProof />
          <SectionDivider />
          <Showcase />
          <SectionDivider />
          <TrustBlocks />
          <SectionDivider />
          <FAQ />
          <SectionDivider />
          <Pricing />
          <SectionDivider />
          <TeamContact />
          <SectionDivider />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </SmoothScrollProvider>
  );
}
