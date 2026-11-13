import { BrandMark, BrandWordmark } from "@/components/layout/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-navy-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "radial-gradient(60% 50% at 20% 0%, rgb(61 99 201 / 0.28), transparent 70%), radial-gradient(50% 40% at 100% 100%, rgb(125 147 181 / 0.18), transparent 70%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10" />
          <BrandWordmark inverted />
        </div>

        <div className="relative max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-navy-400 uppercase">Production operating system</p>
          <h1 className="mt-4 text-[34px] leading-[1.15] font-semibold tracking-tight text-white">
            Every brief, decision and cut — in one place.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-200">
            From the client&apos;s first message to the approved final edit: briefs, storyboards, time and reviews stay organized
            for the whole Javora team.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/10">
            {[
              ["Brief", "versioned"],
              ["Storyboard", "approved"],
              ["Delivery", "reviewed"],
            ].map(([a, b]) => (
              <div key={a} className="bg-navy-900/90 px-4 py-3.5">
                <p className="text-[13px] font-medium text-white">{a}</p>
                <p className="mt-0.5 text-xs text-navy-400">{b}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-navy-400">Private workspace · Access by invitation only</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="mb-10 flex items-center gap-3 lg:hidden">
          <BrandMark className="size-9" />
          <BrandWordmark />
        </div>
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
