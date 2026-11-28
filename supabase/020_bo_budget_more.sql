-- =====================================================================
-- Heartbeat · Box Office: more budgets found on Google (Koimoi, Republic, NewsBytes, The Week, FlickOnClick, OTTplay via Filmibeat).
-- Run AFTER 018. Safe to run again. Also lets budget links point at any https news site.
-- =====================================================================
alter table public.bo_budget drop constraint if exists bo_budget_url_check;
alter table public.bo_budget add constraint bo_budget_url_check check (url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}/' and char_length(url) <= 300);

insert into public.bo_budget (tmdb_id, title, budget_cr, high_cr, source_name, url) values
  (1408162, 'Vishwanath & Sons', 120, 130, 'Koimoi', 'https://www.koimoi.com/box-office/vishwanath-sons-box-office-how-much-does-suriyas-film-need-to-enter-the-safe-zone/'),
  (1407432, 'Anaganaga Oka Raju', 8, null, 'Koimoi', 'https://www.koimoi.com/box-office/anaganaga-oka-raju-box-office-day-14-naveen-polishettys-film-registers-a-roaring-509-3-profit-next-milestone-loading/'),
  (1384514, 'The Vvaan', 80, 100, 'FlickOnClick', 'https://www.flickonclick.com/the-vvaan-movie-budget-and-cast-salary/'),
  (1509599, 'Gatta Kusthi 2', 27, null, 'Koimoi', 'https://www.koimoi.com/box-office/gatta-kusthi-2-box-office-completes-a-month-in-theatres-heres-its-budget-collection-verdict/'),
  (1506736, 'Thudakkam', 15, null, 'The Week', 'https://www.theweek.in/news/entertainment/2026/09/05/thudakkam-ott-release-date.html'),
  (1417849, 'Nari Nari Naduma Murari', 21, 40, 'Koimoi (OTTplay says ₹40 Cr)', 'https://www.koimoi.com/box-office/nari-nari-naduma-murari-box-office-collection-day-9-sharwanand-starrer-recovers-nearly-68-budget-is-it-heading-towards-failure/'),
  (1451078, 'Raakaasa', 10, 15, 'Koimoi', 'https://www.koimoi.com/box-office/raakaasa-box-office-collection-day-9-its-a-profitable-affair-now-the-8th-highest-telugu-grosser-of-2026/'),
  (1103473, 'KD: The Devil', 100, null, 'Koimoi', 'https://www.koimoi.com/box-office/kd-the-devil-box-office-day-2-early-trends-only-7-budget-recovery-for-dhruva-sarja-sanjay-dutts-100-crore-biggie/'),
  (1441149, 'Vishnu Vinyasam', 20, null, 'Koimoi', 'https://www.koimoi.com/box-office/vishnu-vinyasam-box-office-collection-day-4-registers-a-decent-monday-yet-to-recover-61-of-budget/'),
  (1215812, 'Karavali', 4.6, 9, 'Koimoi', 'https://www.koimoi.com/box-office/karavali-box-office-collection-day-11-turns-out-to-be-2nd-successful-kannada-film-of-2026-enjoys-53-returns/'),
  (1729323, 'Bhootam Bhayyam', 4, null, 'Koimoi', 'https://www.koimoi.com/box-office/bhootam-bhayyam-box-office-completes-3-weeks-in-theatres-budget-collection-verdict/'),
  (1743690, 'Mamachya Govyala Jauya', 3.5, null, 'Koimoi', 'https://www.koimoi.com/box-office/mamachya-govyala-jauya-box-office-closing-collection-wraps-up-its-disappointing-run-with-a-41-deficit/')
on conflict (tmdb_id) do update set budget_cr = excluded.budget_cr, high_cr = excluded.high_cr, source_name = excluded.source_name, url = excluded.url, updated_at = now();
