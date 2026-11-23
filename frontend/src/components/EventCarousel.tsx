import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatEventDate, categoryKey } from '../i18n';
import { formatKZT, type EventItem } from '../services/events';

interface EventCarouselProps {
  events: EventItem[];
}

export const EventCarousel: React.FC<EventCarouselProps> = ({ events }) => {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = events.length;

  const nextSlide = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % total);
  }, [total]);

  const prevSlide = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  }, [total]);

  const goToSlide = (idx: number) => {
    setCurrentIndex(idx);
  };

  // Auto-play timer
  useEffect(() => {
    if (isPaused || total <= 1) return;
    timerRef.current = setInterval(() => {
      nextSlide();
    }, 4500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, total, nextSlide]);

  if (total === 0) return null;

  const currentEvent = events[currentIndex];
  const minPrice = currentEvent.ticketTiers?.length
    ? Math.min(...currentEvent.ticketTiers.map((tier) => tier.priceKZT))
    : null;

  // Touch handlers for mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.targetTouches[0].clientX);
    setIsPaused(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (touchStartX !== null && touchEndX !== null) {
      const diff = touchStartX - touchEndX;
      if (diff > 50) {
        nextSlide();
      } else if (diff < -50) {
        prevSlide();
      }
    }
    setTouchStartX(null);
    setTouchEndX(null);
    setIsPaused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      prevSlide();
    } else if (e.key === 'ArrowRight') {
      nextSlide();
    }
  };

  return (
    <section
      className="relative mb-8 overflow-hidden rounded-2xl bg-gray-950 text-white shadow-xl ring-1 ring-white/10"
      aria-roledescription="carousel"
      aria-label={t('carousel.featured', { defaultValue: 'Featured events' })}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Slide container */}
      <div className="relative aspect-[16/9] sm:aspect-[21/9] min-h-[360px] sm:min-h-[420px] w-full overflow-hidden">
        {/* Background Image with smooth fade */}
        {events.map((event, idx) => {
          const isActive = idx === currentIndex;
          return (
            <div
              key={event.id}
              className={`absolute inset-0 transition-opacity duration-700 ease-out ${
                isActive ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'
              }`}
              aria-hidden={!isActive}
            >
              {event.imageUrl ? (
                <img
                  src={event.imageUrl}
                  alt={event.title}
                  className="h-full w-full object-cover object-center transform scale-105 motion-safe:transition-transform motion-safe:duration-7000 motion-safe:ease-out"
                  loading={idx === 0 ? 'eager' : 'lazy'}
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-indigo-950 via-slate-900 to-blue-950" />
              )}

              {/* Cinematic Vignette Gradients */}
              <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-gray-950/90 via-gray-950/40 to-transparent" />

              {/* Content Overlay */}
              <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-10 z-20 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2 mb-2 sm:mb-3">
                  <span className="rounded-full bg-blue-600/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur-md">
                    {t(`categories.${categoryKey(event.category)}`, { defaultValue: event.category })}
                  </span>
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
                    📅 {formatEventDate(event.startsAt, event.timezone, 'card')}
                  </span>
                  {minPrice !== null && (
                    <span className="rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-bold text-white backdrop-blur-md">
                      {minPrice > 0
                        ? t('carousel.from', { price: formatKZT(minPrice), defaultValue: `From ${formatKZT(minPrice)}` })
                        : t('carousel.free', { defaultValue: 'Free Entry' })}
                    </span>
                  )}
                </div>

                <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white drop-shadow-md">
                  {event.title}
                </h2>

                <p className="mt-2 flex items-center gap-1.5 text-xs sm:text-sm text-gray-300">
                  <span className="text-blue-400">📍</span> {event.venueName} · {event.venueAddress}
                </p>

                {event.description && (
                  <p className="mt-2 line-clamp-2 text-xs sm:text-sm text-gray-300/90 max-w-xl">
                    {event.description}
                  </p>
                )}

                <div className="mt-4 sm:mt-6 flex items-center gap-3">
                  <Link
                    to={`/events/${event.id}`}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 sm:px-6 sm:py-3 text-sm font-bold text-white shadow-lg transition hover:bg-blue-500 hover:shadow-blue-500/30 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <span>{t('carousel.viewEvent', { defaultValue: 'View Event & Tickets' })}</span>
                    <span aria-hidden="true">→</span>
                  </Link>

                  <span className="text-xs text-gray-400 font-mono hidden sm:inline">
                    {t('carousel.slideOf', {
                      current: String(idx + 1).padStart(2, '0'),
                      total: String(total).padStart(2, '0'),
                      defaultValue: `${idx + 1} / ${total}`
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Carousel Navigation Arrows */}
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={prevSlide}
              aria-label={t('carousel.previous', { defaultValue: 'Previous slide' })}
              className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-30 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/70 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white"
            >
              <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={nextSlide}
              aria-label={t('carousel.next', { defaultValue: 'Next slide' })}
              className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 z-30 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/70 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white"
            >
              <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* Bottom Carousel Indicators & Controls */}
        <div className="absolute bottom-4 right-4 sm:right-8 z-30 flex items-center gap-2">
          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            aria-label={
              isPaused
                ? t('carousel.play', { defaultValue: 'Play carousel' })
                : t('carousel.pause', { defaultValue: 'Pause carousel' })
            }
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md transition hover:bg-black/80 hover:text-white"
            title={isPaused ? 'Resume auto-play' : 'Pause auto-play'}
          >
            {isPaused ? (
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            )}
          </button>

          {/* Dots */}
          <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1.5 backdrop-blur-md">
            {events.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => goToSlide(idx)}
                aria-label={t('carousel.slideOf', {
                  current: idx + 1,
                  total,
                  defaultValue: `Slide ${idx + 1} of ${total}`
                })}
                aria-current={idx === currentIndex ? 'true' : 'false'}
                className={`h-2 rounded-full transition-all duration-300 ${
                  idx === currentIndex
                    ? 'w-6 bg-blue-500 shadow-sm shadow-blue-500/50'
                    : 'w-2 bg-white/40 hover:bg-white/80'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
