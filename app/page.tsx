import { Header } from "@/components/Header";
import { RouteCard } from "@/components/RouteCard";
import { allPlaces, allRoutes } from "@/lib/data";

export default function Home() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <section className="rounded-3xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 sm:py-12 overflow-hidden">
          <div className="max-w-3xl">
            <p className="mb-3 inline-flex max-w-full rounded-full bg-primary-foreground/15 px-3 py-1 text-xs tracking-wide break-words">
              Цифровой сервис для самостоятельного знакомства с Владивостоком и Приморьем
            </p>
            <h1 className="font-serif text-[28px] font-normal leading-tight break-words hyphens-auto sm:text-4xl">
              VladGuide AI — маршруты и интеллектуальный помощник по достопримеча&shy;тельностям
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-primary-foreground/80 sm:text-base">
              Знакомьтесь с историей и архитектурой Владивостока в своём темпе. Выбирайте маршрут,
              открывайте интересные места на карте и узнавайте о них больше с помощью гида.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-2 text-center sm:max-w-lg sm:gap-3">
            <div className="rounded-2xl bg-primary-foreground/10 px-2 py-3 min-w-0">
              <div className="text-xl font-semibold">{allRoutes.length}</div>
              <div className="text-[11px] leading-tight text-primary-foreground/70 sm:text-xs">маршрутов</div>
            </div>
            <div className="rounded-2xl bg-primary-foreground/10 px-1.5 py-3 min-w-0 sm:px-2">
              <div className="text-xl font-semibold">{allPlaces.length}</div>
              <div className="text-[11px] leading-tight text-primary-foreground/70 break-words hyphens-auto sm:text-xs">достопримеча&shy;тельностей</div>
            </div>
            <div className="rounded-2xl bg-primary-foreground/10 px-2 py-3 min-w-0">
              <div className="text-xl font-semibold">Бесплатно</div>
              <div className="text-[11px] leading-tight text-primary-foreground/70 sm:text-xs">доступ к гиду</div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-serif text-xl font-normal">Готовые маршруты</h2>
            <span className="text-sm text-muted-foreground">Выберите прогулку по интересам и времени</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allRoutes.map((r) => (
              <RouteCard key={r.id} route={r} />
            ))}
          </div>
        </section>

      </main>
      <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-center text-xs text-muted-foreground sm:px-6">
        VladGuide AI · Владивосток · Открывайте город в своём темпе
      </footer>
    </>
  );
}
