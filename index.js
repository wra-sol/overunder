exports.overUnder = async (req, res) => {
	const fetch = require('node-fetch');
	const HTMLParser = require('node-html-parser');
	const CSV = require('csv-string');
	const fs = require('fs-extra');
	async function teamMap() {
		const map = await fs.readFile('teamsMap.csv');
		return `${map}`;
	}
	async function playerMap() {
		const map = await fs.readFile('playerMap.csv');
		return `${map}`;
	}
	const date = new Date();
	const dateArr = date.toISOString().split("T")[0].split("-");
	const mlbDate = `${dateArr[1]}/${dateArr[2]}/${dateArr[0]}`;
	const matchups = {}
	const expected = []
	const teams = []
	async function getLines() {
		const bets = []
		const res = await fetch('https://sportsbook-ca-on.draftkings.com//sites/CA-ON-SB/api/v4/eventgroups/88670847/categories/729/subcategories/6459?format=json');
		const html = await res.json();
		const data = html.eventGroup.events;
		for (var i = 0; i < data.length; i++) {
			const lines = html.eventGroup.offerCategories.find(offer => offer.name == "Innings").offerSubcategoryDescriptors.find(type => type.subcategoryId == 6459).offerSubcategory.offers;
			for (var x = 0; x < lines.length; x++) {	
				if (lines[x][0].providerEventId == data[i].providerEventId) {
					const f5 = lines[x].find(line => line.label == 'Total 1st 5 Innings');	
					f5 ? bets.push({teams:`${data[i].teamShortName1}@${data[i].teamShortName2}`, "game_id": `${data[i].providerEventId}`, "line":f5.outcomes[0].line, "over_odds":f5.outcomes[0].oddsAmerican, "under_odds":f5.outcomes[1].oddsAmerican}) : null
				}
			};
		}
		return bets;
	}
	async function getTeams() {
		const res = await fetch('https://statsapi.mlb.com/api/v1/teams/');
		const teamsObj = await res.json();
		teams.push(teamsObj);
	}
	async function getGames() {
		
		const battingStats = {};
		const fgTBatting = await fetch('https://www.fangraphs.com/leaders.aspx?pos=all&stats=bat&lg=all&qual=0&type=8&season=2022&month=3&season1=2022&ind=0&team=0,ts&rost=&age=0&filter=&players=0');
		const fgTeamsBattingRaw = await fgTBatting.text();
		const teamsBatting = HTMLParser.parse(fgTeamsBattingRaw.slice(fgTeamsBattingRaw.indexOf("<html"), fgTeamsBattingRaw.indexOf("</html>")));
		const lines = teamsBatting.querySelectorAll('.rgMasterTable > tbody > tr');
		lines.forEach((row, rowIndex) => {
			const lineRow = row.structuredText.replace(/(\r\n|\n|\r)/gm, ",").trim().split(",")
			battingStats[lineRow[1]] = lineRow[16].trim()
		})
		console.log(battingStats);
		function getCode(id) {
			for (var i = 0; i < teams[0].teams.length; i++) {
				if (id == teams[0].teams[i].id) {
					return teams[0].teams[i].abbreviation;
				}
			}
		}
		async function getStarters(id) {
			const gameRes = await fetch(`http://statsapi.mlb.com/api/v1.1/game/${id}/feed/live`);

			const gameInfo = await gameRes.json();
			return gameInfo.gameData.probablePitchers;
		}
		async function getPlayerMap(player) {			
			const players = playersRaw.toString();
			const playerArr = await CSV.parse(players, { output: 'objects' });
			//console.log(playerArr);
			const searchPlayer = playerArr.find(i => i.MLBID == player);
			//	console.log(searchPlayer);
			return searchPlayer;
		}
		async function getTeamMap(team) {			
			const teams = teamRaw.toString();
			const teamArr = await CSV.parse(teams, { output: 'objects' });
			const searchTeam = teamArr.find(i => i.FANPROSTEAM == team);
			//	console.log(searchPlayer);
			return searchTeam;
		}
		async function getFip(id) {
			//console.log(id);
			const playerMap = await getPlayerMap(`${id}`);
			const playerId = playerMap ? playerMap.IDFANGRAPHS : null
			const res = playerId ? await fetch(`https://cdn.fangraphs.com/api/players/splits?playerid=${playerId}&position=P&season=2022&split=inning&z=1654599081111`) : null;
			if (res == null) {
				return null;
			}
			const playerPage = await res.json();
			const all = playerPage.find(x => x.Split == 'As Starter')
			const totalInnings = all ? all.IP : 0;
			if (totalInnings < 25) {
				return null;
			}
			const playerName = playerMap.PLAYERNAME;
			const FTT = playerPage.find(x => x.Split == '1st Through Order as SP');
			const STT = playerPage.find(x => x.Split == '2nd Through Order as SP');
			const fip = (FTT.FIP + STT.FIP) / 2;
			const era = (FTT.ERA + STT.ERA) / 2;
			const fipMinus = (fip / 4.20) * 100;
			const playerStats = {
				"name":playerName,
				"era": era,
				"fip": fip,
				"fip_minus": fipMinus
			}
			return playerStats;
		}
		const sched = await fetch('http://statsapi.mlb.com/api/v1/schedule/games/?sportId=1&date=' + mlbDate);
		const schedule = await sched.json();
		const bookGames = await getLines();
		const playersRaw = await playerMap();
		const teamRaw = await teamMap();
		

		const games = schedule.dates[0].games;
		for (var i = 0; i < games.length; i++) {
			const game = games[i]
			const starters = await getStarters(game.gamePk);
			const homeStarter = starters.home ? await getFip(starters.home.id) : null;
			const awayStarter = starters.away ? await getFip(starters.away.id) : null;
			const homeAbbr = getCode(game.teams.home.team.id);
			const awayAbbr = getCode(game.teams.away.team.id);
			const homeTeamMap = await getTeamMap(`${homeAbbr}`);
			const awayTeamMap = await getTeamMap(`${awayAbbr}`);
			const homeTeamId = homeTeamMap ? homeTeamMap.FANGRAPHSABBR : null
			const awayTeamId = awayTeamMap ? awayTeamMap.FANGRAPHSABBR : null
			Object.keys(game.teams).forEach((gameTeams, index) => {
				matchups[game.gamePk] = {
					"home": {
						"starter": homeStarter ? homeStarter.name : null,
						"name": game.teams.home.team.name,
						"id": game.teams.home.team.id,
						"abbreviation": homeTeamId,
						"opponent_wrc": battingStats[awayTeamId],
						"era": homeStarter ? homeStarter.era : null,
						"fip": homeStarter ? homeStarter.fip.toFixed(2) : null,
						"fip_minus": homeStarter ? homeStarter.fip_minus.toFixed(0) : null

					},
					"away": {
						"starter": awayStarter ? awayStarter.name : null,
						"name": game.teams.away.team.name,
						"id": game.teams.away.team.id,
						"abbreviation": awayTeamId,
						"opponent_wrc": battingStats[homeTeamId],
						"era": awayStarter ? awayStarter.era : null,
						"fip": awayStarter ? awayStarter.fip.toFixed(2) : null,
						"fip_minus": awayStarter ? awayStarter.fip_minus.toFixed(0) : null
					}
				}
			})
		}
		const matchupIds = Object.keys(matchups)
		for (var x = 0; x < matchupIds.length; x++) {
			const game = matchups[matchupIds[x]]
			function expectedRuns(stats) {
				const mappedEra = stats.era / 9 * 5;
				const adjustedEra = mappedEra * (stats.opponent_wrc / 100) * (stats.fip_minus / 100);
				return adjustedEra
			}
			//console.log(game.home.starter,game.away.starter )
			const homeXRuns = expectedRuns(game.home)
			const awayXRuns = expectedRuns(game.away)
			if (homeXRuns < 0 ){
				return;
			}
			if (awayXRuns < 0){
				return;
			}
			const expectedTotal = homeXRuns + awayXRuns;
			const gameName = `${game.away.abbreviation}@${game.home.abbreviation}`;
			const starters = `${game.away.starter} @ ${game.home.starter}`;
			thisGame = bookGames.find((game) => game.teams == gameName);
			const gameId = thisGame ? thisGame.game_id : null;
			const line = thisGame ? thisGame.line : null;
			const overOdds = thisGame ? thisGame.over_odds : null;
			const underOdds = thisGame ? thisGame.under_odds : null;
			function getDiff(expected, line) {
				const diff = expected - line;
				return diff.toFixed(2);
			}
			
			function getBet(expected, line) {
				const diff = expected - line;
				if (diff > 0.6) {
					if (diff > 1.0) {
						return "Over Lock"
					} else {
						return "Over"
					}
				} else if (diff < -0.6) {
					if (diff < -1.0) {
						return "Under Lock"
					} else {
						return "Under"
					}
				} else {
					return "Too close to call"
				}
			}
			if (expectedTotal + 1 > 1 && line != null && game.home.starter != null && game.away.starter != null) {
				expected.push({"game_id": gameId, "starters":starters, "teams": gameName, "expected_runs": expectedTotal.toFixed(1), "over_under": line, "over_odds": overOdds, "under_odds": underOdds, "difference": getDiff(expectedTotal, line), "bet": getBet(expectedTotal, line) });
			}
		}
		//console.log(expected)
		return expected;
	}

	getTeams().then((teams) => {
		getGames().then(response => {
			const values = [];
			response.forEach((game) => {
				//if (game.bet != 'Too close to call') {
					if (game.bet.startsWith('Over')) {
						values.push({"game_id":game.game_id, "starters": game.starters, "teams":game.teams,"bet":game.bet,"line":game.over_under,"odds":game.over_odds})
					} else {
						values.push({"game_id":game.game_id, "starters": game.starters, "teams":game.teams,"bet":game.bet,"line":game.over_under,"odds":game.under_odds})
					}
				//}
			})
			console.log(values);
			res.json({values}).status(200);
		})
	})
}