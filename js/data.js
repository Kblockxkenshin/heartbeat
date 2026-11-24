// Sample catalog. TMDB fills in real posters, backdrops, runtime, genres and overview
// when the app runs online. The text here is the fallback.
export const TITLES = [
  {id:'bb', tmdb:1396, type:'tv', name:'Breaking Bad', year:2008, genres:['Crime','Drama'], seasons:[7,13,13,13,16], overview:'A chemistry teacher gets scary health news and starts cooking meth to pay the bills. Slowly, he becomes someone else.', colors:['#1d5c34','#c9b23a'], shape:[.3,.5,.75,.85,1], flavor:{funny:.15,scary:.3,sad:.35}, twists:[.55,.95], hype:[8.9,9.4], vibes:{'Mind-blowing':.62,'Sad':.2,'Scary':.18}, worth:[.86,.11,.03], best:'Alone at 2am', journey:[3.6,4.4,4.9]},
  {id:'inc', tmdb:27205, type:'movie', name:'Inception', year:2010, genres:['Sci-Fi','Action'], runtime:148, overview:'A thief who steals secrets from dreams gets one last job: plant an idea in someone\'s mind.', colors:['#1b3a6b','#c8873a'], shape:[.45,.55,.6,.8,.9,1,.95], flavor:{funny:.1,scary:.15,sad:.2}, twists:[.5,1], hype:[8.6,8.8], vibes:{'Mind-blowing':.78,'Comfort watch':.08,'Sad':.1}, worth:[.8,.16,.04], best:'With friends', journey:[4.0,4.5,4.8]},
  {id:'st', tmdb:66732, type:'tv', name:'Stranger Things', year:2016, genres:['Sci-Fi','Horror'], seasons:[8,9,8,9,8], overview:'A boy goes missing in a small town. His friends find a strange girl with powers who might know where he is.', colors:['#5a0d13','#e2362f'], shape:[.7,.8,.6,.85,.7], flavor:{funny:.35,scary:.6,sad:.25}, twists:[.3,.75], hype:[8.5,8.0], vibes:{'Scary':.45,'Funny':.3,'Comfort watch':.28}, worth:[.6,.32,.08], best:'With friends', journey:[4.3,3.9,4.0]},
  {id:'opp', tmdb:872585, type:'movie', name:'Oppenheimer', year:2023, genres:['History','Drama'], runtime:180, overview:'The scientist who led the team that built the first atomic bomb, and what it cost him after.', colors:['#3a1a0a','#e0772b'], shape:[.4,.35,.5,.65,.95,.6,.7], flavor:{funny:.05,scary:.2,sad:.4}, twists:[.62], hype:[8.9,8.3], vibes:{'Mind-blowing':.48,'Sad':.25,'Boring':.22}, worth:[.55,.33,.12], best:'Alone at 2am', journey:[3.3,4.6,3.9]},
  {id:'bear', tmdb:136315, type:'tv', name:'The Bear', year:2022, genres:['Comedy','Drama'], seasons:[8,10,10], overview:'A top chef comes home to run his late brother\'s messy sandwich shop in Chicago.', colors:['#0e3b4a','#3fb6c9'], shape:[.55,.85,.6], flavor:{funny:.5,scary:.05,sad:.45}, twists:[.85], hype:[8.0,8.4], vibes:{'Funny':.38,'Sad':.35,'Mind-blowing':.2}, worth:[.62,.3,.08], best:'Date night', journey:[3.8,4.6,4.1]},
  {id:'inter', tmdb:157336, type:'movie', name:'Interstellar', year:2014, genres:['Sci-Fi','Drama'], runtime:169, overview:'Earth is dying. A pilot leaves his kids to look for a new home for people through a hole in space.', colors:['#0a0f24','#7a8bb5'], shape:[.35,.4,.7,.85,.75,.95,1], flavor:{funny:.1,scary:.25,sad:.65}, twists:[.88], hype:[8.4,9.0], vibes:{'Mind-blowing':.7,'Sad':.55,'Comfort watch':.1}, worth:[.84,.13,.03], best:'Alone at 2am', journey:[3.5,4.5,4.9]},
  {id:'squid', tmdb:93405, type:'tv', name:'Squid Game', year:2021, genres:['Thriller','Drama'], seasons:[9,7,6], overview:'Hundreds of people deep in debt join a set of kids\' games. The prize is huge. Losing is deadly.', colors:['#0d5c55','#ef2f74'], shape:[.85,.55,.6], flavor:{funny:.1,scary:.55,sad:.55}, twists:[.65,.9], hype:[8.7,7.6], vibes:{'Scary':.5,'Sad':.45,'Mind-blowing':.3}, worth:[.5,.35,.15], best:'With friends', journey:[4.6,3.8,3.4]},
  {id:'barbie', tmdb:346698, type:'movie', name:'Barbie', year:2023, genres:['Comedy','Fantasy'], runtime:114, overview:'Barbie starts having very un-Barbie thoughts, so she heads to the real world to fix it.', colors:['#e0418f','#ff9fca'], shape:[.75,.7,.55,.65,.8], flavor:{funny:.75,scary:.02,sad:.3}, twists:[], hype:[7.8,7.4], vibes:{'Funny':.7,'Comfort watch':.35,'Sad':.15}, worth:[.45,.4,.15], best:'With friends', journey:[4.4,3.6,4.0]},
  {id:'dune2', tmdb:693134, type:'movie', name:'Dune: Part Two', year:2024, genres:['Sci-Fi','Adventure'], runtime:166, overview:'Paul joins the desert people and gets pulled toward a war he has seen in his visions.', colors:['#5a3510','#e3a35a'], shape:[.5,.6,.7,.85,.95,1], flavor:{funny:.08,scary:.3,sad:.25}, twists:[.8], hype:[8.6,8.9], vibes:{'Mind-blowing':.72,'Scary':.2,'Sad':.15}, worth:[.8,.15,.05], best:'With friends', journey:[3.9,4.5,4.8]},
  {id:'eeaao', tmdb:545611, type:'movie', name:'Everything Everywhere All at Once', year:2022, genres:['Comedy','Sci-Fi'], runtime:139, overview:'A tired laundromat owner learns she must jump between universes to save everything, including her family.', colors:['#3a1460','#f2b33d'], shape:[.55,.8,.7,.9,.85], flavor:{funny:.7,scary:.05,sad:.55}, twists:[.4], hype:[8.0,8.7], vibes:{'Funny':.6,'Sad':.45,'Mind-blowing':.6}, worth:[.72,.2,.08], best:'Date night', journey:[3.7,4.4,4.8]},
  {id:'atsv', tmdb:569094, type:'movie', name:'Across the Spider-Verse', year:2023, genres:['Animation','Action'], runtime:140, overview:'Miles Morales swings across the multiverse and finds a team of Spider-People with a rule he can\'t accept.', colors:['#2b0d4f','#ff3b6b'], shape:[.7,.75,.8,.9,.95], flavor:{funny:.45,scary:.1,sad:.3}, twists:[.9], hype:[8.6,9.1], vibes:{'Mind-blowing':.7,'Funny':.4,'Comfort watch':.2}, worth:[.85,.12,.03], best:'With friends', journey:[4.4,4.6,4.3]},
  {id:'tlou', tmdb:100088, type:'tv', name:'The Last of Us', year:2023, genres:['Drama','Horror'], seasons:[9,7], overview:'A tough smuggler has to get a teenage girl across a broken America after a fungus ends the world.', colors:['#1f2f1a','#7d9a5b'], shape:[.75,.6], flavor:{funny:.1,scary:.6,sad:.7}, twists:[.4], hype:[8.8,8.2], vibes:{'Sad':.65,'Scary':.45,'Mind-blowing':.3}, worth:[.7,.22,.08], best:'Alone at 2am', journey:[4.5,4.2,3.8]},
  {id:'wed', tmdb:119051, type:'tv', name:'Wednesday', year:2022, genres:['Comedy','Mystery'], seasons:[8,8], overview:'Wednesday Addams starts at a new school for outcasts and gets pulled into a string of monster murders.', colors:['#111111','#7a3fbf'], shape:[.8,.7], flavor:{funny:.55,scary:.35,sad:.1}, twists:[.85], hype:[8.0,7.5], vibes:{'Funny':.5,'Comfort watch':.4,'Scary':.25}, worth:[.5,.38,.12], best:'Family', journey:[4.3,3.8,3.6]},
  {id:'para', tmdb:496243, type:'movie', name:'Parasite', year:2019, genres:['Thriller','Comedy'], runtime:132, overview:'A broke family cons its way into working for a rich one, until a secret in the basement changes everything.', colors:['#16302b','#c9c47a'], shape:[.6,.7,.95,.8,.9], flavor:{funny:.45,scary:.4,sad:.4}, twists:[.5], hype:[8.5,9.0], vibes:{'Mind-blowing':.75,'Funny':.3,'Scary':.3}, worth:[.82,.14,.04], best:'Date night', journey:[4.1,4.8,4.6]},
  {id:'shogun', tmdb:126308, type:'tv', name:'Shōgun', year:2024, genres:['Drama','History'], seasons:[10], overview:'An English sailor washes up in 1600 Japan and gets caught in a deadly fight for power.', colors:['#3a0d0d','#c7503b'], shape:[.45,.9], flavor:{funny:.1,scary:.3,sad:.4}, twists:[.6], hype:[8.3,8.8], vibes:{'Mind-blowing':.55,'Sad':.3,'Boring':.15}, worth:[.7,.22,.08], best:'Alone at 2am', journey:[3.4,4.5,4.7]},
  {id:'arcane', tmdb:94605, type:'tv', name:'Arcane', year:2021, genres:['Animation','Action'], seasons:[9,9], overview:'Two sisters end up on opposite sides of a war between a shiny city and the dark streets under it.', colors:['#16243f','#36c5d6'], shape:[.75,.9], flavor:{funny:.2,scary:.25,sad:.6}, twists:[.65], hype:[8.4,9.1], vibes:{'Mind-blowing':.65,'Sad':.5,'Comfort watch':.1}, worth:[.86,.11,.03], best:'Alone at 2am', journey:[4.2,4.6,4.8]},
];
export const BYID = Object.fromEntries(TITLES.map(t => [t.id, t]));

export const LISTS = {
  trending: {emoji:'🔥', name:'Trending this week', ids:['dune2','st','bear','shogun','squid','opp','wed','arcane']},
  gems:     {emoji:'💎', name:'Hidden gems',        sort:t => (t.hype[1]-t.hype[0]), take:6},
  overhyped:{emoji:'🎈', name:'Most overhyped',     sort:t => (t.hype[0]-t.hype[1]), take:6},
  quit:     {emoji:'🚪', name:'Most quit',          ids:['opp','shogun','wed','squid','st','tlou']},
};

export const PEOPLE = [
  {h:'maya.watches', c:'#ff4f9a', r:{bb:5,inc:4.5,st:4,opp:3.5,bear:4.5,inter:4.5,squid:3.5,barbie:3,dune2:4.5,arcane:5}},
  {h:'deshawn_films',c:'#62b8ff', r:{bb:4.5,inc:5,st:3,opp:4.5,inter:5,squid:3,barbie:2.5,dune2:5,para:5}},
  {h:'priya.reels',  c:'#ffd35c', r:{bb:3.5,st:4.5,bear:3,squid:4.5,barbie:4.5,inc:3,wed:4.5,eeaao:4}},
  {h:'leo2am',       c:'#9b6bff', r:{bb:5,inc:4,opp:4,bear:4.5,inter:4,squid:4,shogun:5,tlou:4.5}},
  {h:'sofi.cine',    c:'#4fe3b0', r:{st:5,squid:4.5,barbie:4,bear:2.5,inc:3.5,opp:3,wed:5,atsv:4.5}},
  {h:'tomvsfilm',    c:'#ff8a4c', r:{bb:4,inc:4.5,opp:5,inter:4.5,barbie:2,bear:3.5,para:5,eeaao:4.5}},
];

export const HANDLES = ['nina.reacts','bingeboss','2amcinema','filmfrank','reelrachel','couchcritic','popcornpete','slowburnsam'];
export const TAGS = ['Boring','Amazing','Funny','Scary','Sad','Plot twist'];
export const TAGC = {'Boring':'#8a80a0','Amazing':'#ffd35c','Funny':'#4fe3b0','Scary':'#9b6bff','Sad':'#62b8ff','Plot twist':'#ff4f9a'};
export const VIBEE = {'Funny':'😂','Scary':'😱','Sad':'😢','Mind-blowing':'🤯','Boring':'😴','Comfort watch':'🛋️'};
export const WORTH = ['Must watch','Watch if bored','Skip'];
export const BESTE = {'Date night':'💘','Family':'👨‍👩‍👧','Alone at 2am':'🌙','With friends':'🍕'};

export const BADGES = [
  {id:'first',  e:'🌱', name:'First rating',      test:s => s.rated >= 1},
  {id:'ten',    e:'🎬', name:'Rated 10',          test:s => s.rated >= 10},
  {id:'gem',    e:'💎', name:'Hidden Gem Hunter', test:s => s.gems >= 2},
  {id:'journey',e:'🧭', name:'Journey Judge',     test:s => s.journeys >= 5},
  {id:'streak3',e:'🔥', name:'3-day streak',      test:s => s.streak >= 3},
  {id:'swiper', e:'⚡', name:'Quick Rater',       test:s => s.swipes >= 20},
  {id:'list',   e:'🔖', name:'Planner',           test:s => s.saved >= 5},
  {id:'twin',   e:'💞', name:'Found a twin',      test:s => s.bestMatch >= 80},
  {id:'week',   e:'🏆', name:'7-day streak',      test:s => s.streak >= 7},
];
