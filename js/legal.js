// Heartbeat legal pages (Part 9): Terms of Service, Privacy Policy, Community Guidelines.
// Written in plain, simple English. This is a starting point — have a lawyer review it before you rely on it.
//
// Fill these in:
export const LEGAL = {
  version: '2026-11-25',          // change this date when you change the Terms or Privacy Policy (people are asked to agree again)
  operator: 'the Heartbeat team', // the person or company that runs Heartbeat, e.g. "Heartbeat Apps LLC"
  law: '',                        // e.g. "the State of Texas, USA". Empty = "where the operator is based"
};
const C = '<a class="see" href="#/contact">Contact us</a>';
const law = () => LEGAL.law || 'the place where the operator of Heartbeat is based';

export const DOCS = {
  terms: {
    title: 'Terms of Service', icon: '📜',
    summary: ['You must be 13 or older. Under 18? Use Heartbeat with a parent or guardian\'s OK.', 'Be kind and follow the Community Guidelines.',
      'Your reviews stay yours, but you let us show them in Heartbeat.', 'Heartbeat Plus renews until you cancel. You can cancel any time.',
      'Movie and TV info comes from TMDB.'],
    sections: [
      ['Who we are', [`Heartbeat is an app for rating movies and TV shows by their start, middle and ending. It is run by ${LEGAL.operator} ("we", "us"). By making an account or using Heartbeat, you agree to these Terms and to our <a class="see" href="#/privacy">Privacy Policy</a> and <a class="see" href="#/guidelines">Community Guidelines</a>.`]],
      ['Who can use Heartbeat', ['You must be <b>13 or older</b>. If you are under 18, please use Heartbeat only with the permission of a parent or guardian.', 'People under 18 get extra safety settings (see the Privacy Policy). You can\'t use Heartbeat if the law where you live doesn\'t allow it.']],
      ['Your account', ['Give true information, keep your password safe, and don\'t share your account. You are responsible for what happens in your account.', 'We recommend 2-step sign-in (Me → Security). Admins and studio teams must use it.']],
      ['Your content', ['You keep ownership of what you post (ratings, reviews, comments, messages, photos).', 'You give us a free, worldwide, non-exclusive license to store, show, copy and share your public content <b>inside Heartbeat</b> and in share images you make, so the app can work. This ends when you delete the content or your account (copies other people already shared may stay).', 'Only post things you have the right to post.']],
      ['Rules and moderation', ['Follow the <a class="see" href="#/guidelines">Community Guidelines</a>.', 'Reviews are checked by rules and by AI (Claude, by Anthropic) before they go public. Some are held for a person to check. You can change a blocked review or ask a person to look again ("appeal").', 'We may hide content, hold ratings, pause or ban accounts that break the rules. You can see the reason in the app.']],
      ['Heartbeat Plus', ['Plus is a paid subscription. The price is shown before you pay. Payments are handled by Stripe.', 'It renews automatically each month or year until you cancel. You can cancel any time in Me → Heartbeat Plus; you keep Plus until the end of the paid period.', 'Free trials turn into paid plans at the end unless you cancel before. The student price needs a school email.', 'Refunds follow the law where you live. If something went wrong, ' + C + '.', 'Plus is for people 18 and older.']],
      ['Heartbeat for Studios', ['Studios that use our dashboard sign a separate agreement. They only see grouped, anonymous numbers. They never get your name, profile, single ratings or messages.', 'Screener panels are opt-in. If you join one, keep the videos private, and know that your answers go to the studio without your name.']],
      ['Movie and TV information', ['Posters, titles and other details come from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.', 'Trailers are shown from YouTube or Vimeo, under their own terms.']],
      ['Things you must not do', ['Break the law, hack or overload Heartbeat, scrape it, use bots or fake accounts, sell accounts, cheat XP or rankings, or try to get around safety checks or bans.']],
      ['Copyright', [`If you think something on Heartbeat breaks your copyright, ${C} with the details (what it is, where it is, and how to reach you). We will remove it if needed.`]],
      ['Our promise and its limits', ['We work hard to keep Heartbeat running and safe, but it is provided "as is". We can\'t promise it will always be available or free of mistakes. Ratings, reviews and AI summaries are opinions, not facts.', 'As far as the law allows, we are not responsible for indirect losses, and our total responsibility to you is limited to what you paid us in the last 12 months (or $50 if that is more). Some places don\'t allow these limits, so they may not apply to you.']],
      ['Ending', ['You can delete your account any time (Me → Security → Delete my account). We may end or pause accounts that break these Terms.']],
      ['Changes', ['If we change these Terms, we will show the new date and ask you to agree again in the app. If you don\'t agree, you can stop using Heartbeat and delete your account.']],
      ['Law', [`These Terms follow the laws of ${law()}, except where the law where you live gives you rights we can\'t take away.`]],
      ['Questions', [`${C} — we read every message.`]],
    ],
  },
  privacy: {
    title: 'Privacy Policy', icon: '🔒',
    summary: ['We never sell your personal information.', 'Studios only see grouped, anonymous numbers — and you can opt out.', 'Your birthday is private. Under-18s get extra protection.',
      'You can download all your data or delete your account any time.', 'Without an account, your ratings stay on your device.'],
    sections: [
      ['What this covers', [`This explains what information Heartbeat keeps, why, and your choices. Heartbeat is run by ${LEGAL.operator}.`]],
      ['What we keep', [
        '<b>Account:</b> email, username, password (scrambled by our sign-in provider), birthday (only you can see it), and if you add them: display name, bio, profile photo, favorite titles.',
        '<b>What you do in the app:</b> ratings, quick-rate swipes, watchlist, reviews, comments, likes, friends, follows, blocks, chat messages, recommendations, trailer reactions, XP, streaks, leagues, picks, reports and appeals.',
        '<b>Safety information:</b> a scrambled (one-way) code of your device and IP address, a rough region (like a country), and a security log (for example, too many ratings at once). We never keep your real IP address.',
        '<b>Payments:</b> if you buy Plus, Stripe handles the payment. We see your plan and status, never your card number.',
        '<b>Messages to us:</b> what you send through Contact us.'
      ]],
      ['Without an account', ['Your ratings and lists are saved only on your device (in your browser storage). We don\'t see them.']],
      ['Why we use it', ['To run Heartbeat (save your ratings, show friends\' activity, send recommendations), keep it safe (stop spam, bots, fake reviews and review-bombing), run the game (XP, ranks, leagues), handle Plus, and answer you.', 'We do not use your information for ads from other companies.']],
      ['AI', ['Reviews you post are checked by Claude (an AI made by Anthropic) for spam, hate and spoilers, and to give a quality score. Studios can ask for an AI summary of <b>public</b> reviews, without names. Anthropic processes this for us and does not use it to train its models under our business terms.']],
      ['Who we share with', [
        '<b>Service providers</b> that run Heartbeat for us: Supabase (database and sign-in), Vercel (hosting), Stripe (payments), Anthropic (AI checks), Cloudflare (robot check), and TMDB (movie data — we don\'t send them your personal information). They may only use your data to help us.',
        '<b>Other people</b> see what you choose to share: your public profile, public reviews and comments, and what friends can see. Under-18 profiles are friends-only.',
        '<b>Studios</b> only see totals and averages from members who are 18+, trusted, and didn\'t opt out. Groups smaller than 10 people are hidden. Studios never get names, profiles, single ratings or messages. Screener panel answers (opt-in) go to the studio without your name.',
        '<b>The law:</b> we may share information if the law requires it or to protect people\'s safety.',
        '<b>We never sell your personal information</b> and we don\'t "share" it for cross-site advertising.'
      ]],
      ['Videos', ['Trailers play from YouTube (privacy-enhanced mode) or Vimeo. When you press play, they may collect information under their own privacy policies.']],
      ['Cookies and storage', ['We don\'t use advertising or tracking cookies. We use your browser storage to keep you signed in, save settings, and save ratings offline.']],
      ['People under 18', ['You must be 13 or older. If we learn someone under 13 made an account, we delete it.', 'For people under 18: profiles are friends-only, only friends can message them, they can\'t be found by name in search, they are never counted in studio numbers or invited to screener panels, and they can\'t buy Plus.']],
      ['How long we keep it', ['We keep your information while you have an account. When you delete your account, we delete it right away (it can stay in backups for a short time). We keep security log entries without your name for safety.']],
      ['Your choices and rights', [
        '<b>Download your data:</b> Me → Security → Download my data.',
        '<b>Delete your account:</b> Me → Security → Delete my account.',
        '<b>Fix your information:</b> edit your profile any time.',
        '<b>Studios:</b> turn off "Include me in studio stats" in Me → Security. Screener panels are off unless you turn them on.',
        `<b>Other requests</b> (for example under GDPR or the California CCPA/CPRA): ${C} with the topic "Privacy". We answer within 30 days and won\'t treat you differently for using your rights.`
      ]],
      ['Where data is stored', ['Our providers may store data in the United States and other countries. When data leaves your country, we rely on our providers\' legal safeguards (like Standard Contractual Clauses).']],
      ['Security', ['We use encryption in transit, strict database rules, 2-step sign-in, and limits that stop abuse. No system is perfect, so please use a strong password and 2-step sign-in.']],
      ['Changes', ['If we change this policy, we will show the new date and let you know in the app.']],
      ['Contact', [`${C} — choose "Privacy".`]],
    ],
  },
  guidelines: {
    title: 'Community Guidelines', icon: '🤝',
    summary: ['Be kind — talk about the movie, not the person.', 'Hide spoilers.', 'Be honest: no fake accounts, paid reviews or rating waves.', 'No spam, hate, bullying or sexual content.', 'Report what breaks the rules. Appeal if we got it wrong.'],
    sections: [
      ['Be kind', ['Disagree with the review, not the person. No insults, threats, bullying or harassment. No hate against people for race, religion, gender, sexuality, disability or where they are from.']],
      ['Hide spoilers', ['Use the 🙈 button to hide spoilers, or mark the whole review as having spoilers. Our AI may hide spoiler sentences for you.']],
      ['Be honest', ['Rate what you really watched. One account per person. No fake accounts, bots, paid or swapped reviews, vote rings, or rating waves on one title ("review-bombing"). These are held, removed or banned.']],
      ['Keep it about the title', ['No ads, links, self-promotion, "follow me", or copied text (like plot summaries from other websites). Write in your own words — computer-made filler isn\'t allowed.']],
      ['Keep it clean', ['No sexual content, and nothing that puts anyone in danger. Mild swearing in a review is OK.']],
      ['Protect privacy', ['Don\'t share anyone\'s personal information (addresses, phone numbers, private photos), including your own.']],
      ['Keep teens safe', ['People under 18 can only chat with friends. Never ask a younger person for private chats, photos or personal details. We act fast on reports about this.']],
      ['Screener panels', ['If a studio shows you a trailer or early cut, keep it private. Don\'t record or share it.']],
      ['What happens if rules are broken', ['Content can be blocked, hidden, or held for a person. XP can be removed. Accounts can be paused for a few days or banned. You will see the reason in the app.']],
      ['Report and appeal', ['Use the ⋯ menu or 🚩 Report on any review, comment, message or profile. If your review was blocked, press "Ask a person" to appeal.', `For anything else, ${C}.`]],
    ],
  },
};
