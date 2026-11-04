import Link from "next/link";
import CRTWarp from "@/components/CRTWarp";
import DecryptedText from "@/components/DecryptedText";

// Change to "/login" when the sign-in screen exists.
const PLAY_HREF = "/game/demo";
const OLIVE_DARK = "#4b5320";
const OLIVE_LIGHT = "#9db35a";
const TUBE = "#120f17";

export default function Home() {
  return (
    <main className="title-screen relative isolate h-screen w-full overflow-hidden" style={{ background: TUBE }}>
      <CRTWarp
        color={OLIVE_DARK} backgroundColor={TUBE} mask="aperture"
        curvature={0.25} persistence={0.4} brightness={1.4}
        mouseReact={false} changeOnClick={false}
        className="pointer-events-none"
        style={{ position: "fixed", inset: 0, zIndex: -1 }}
      />
      <div className="pointer-events-none relative z-10 flex h-full flex-col items-center justify-center px-6 text-center" style={{ color: OLIVE_LIGHT }}>
        <p className="title-tagline mb-4 text-xs uppercase tracking-[0.5em]">
          <DecryptedText text="Alea iacta est" animateOn="view" sequential revealDirection="start" speed={45} scrambleColor={OLIVE_DARK} />
        </p>
        <h1 className="title-heading text-5xl font-bold tracking-[0.25em] sm:text-7xl md:text-8xl" style={{ textShadow: "0 0 24px rgba(157,179,90,0.45)" }}>
          <DecryptedText text="ORBIS VICTOR" animateOn="view" effect="scramble" sequential revealDirection="center" speed={80} scrambleColor={OLIVE_DARK} characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&" />
        </h1>
        <p className="title-slogan mt-4 text-lg italic">
          <DecryptedText text="The die is cast. Conquer the world." animateOn="view" sequential revealDirection="start" speed={30} scrambleColor={OLIVE_DARK} />
        </p>
        <Link href={PLAY_HREF} className="play-button pointer-events-auto mt-12 rounded border-2 px-10 py-3 text-xl font-semibold uppercase tracking-[0.3em] transition-colors hover:bg-[#9db35a] hover:text-black focus-visible:bg-[#9db35a] focus-visible:text-black focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-[#9db35a] motion-reduce:transition-none" style={{ borderColor: OLIVE_LIGHT }}>
          <DecryptedText text="> Press Play" animateOn="view" sequential revealDirection="start" speed={50} scrambleColor={OLIVE_DARK} />
        </Link>
      </div>
    </main>
  );
}
