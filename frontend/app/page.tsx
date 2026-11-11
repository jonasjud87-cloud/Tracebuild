import "@/components/landing/v3/landing.css";
import AuthHashRedirect from "@/components/auth/AuthHashRedirect";
import SmoothScrollProvider from "@/components/landing/v3/SmoothScrollProvider";
import LandingShell from "@/components/landing/v3/LandingShell";
import IntroOverlay from "@/components/landing/v3/IntroOverlay";
import Navbar from "@/components/landing/v3/Navbar";
import Hero from "@/components/landing/v3/Hero";
import Marquee from "@/components/landing/v3/Marquee";
import Problem from "@/components/landing/v3/Problem";
import Approach from "@/components/landing/v3/Approach";
import Product from "@/components/landing/v3/Product";
import Quality from "@/components/landing/v3/Quality";
import Team from "@/components/landing/v3/Team";
import Footer from "@/components/landing/v3/Footer";

export default function LandingPage() {
  return (
    <SmoothScrollProvider>
      <AuthHashRedirect />
      <LandingShell>
        <IntroOverlay />
        <a href="#tb-main" className="tbl-skip">
          Zum Inhalt springen
        </a>
        <Navbar />
        <main id="tb-main">
          <Hero />
          <Marquee />
          <Problem />
          <Approach />
          <Product />
          <Quality />
          <Team />
        </main>
        <Footer />
      </LandingShell>
    </SmoothScrollProvider>
  );
}
