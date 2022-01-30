const {MatrixClient, LogService, LogLevel, UserID} = require("matrix-bot-sdk");
const readline = require("readline-sync");
const yargs = require("yargs");
const fs = require("fs");

// Missing functionality from matrix-bot-sdk
class MatrixClientEx extends MatrixClient
{
	// Get the list of room aliases
	async getRoomAliases(roomId)
	{
		return this.doRequest("GET", "/_matrix/client/r0/rooms/" + encodeURIComponent(roomId) + "/aliases").then(response => response['aliases']);
	}
}

// Load settings - see settings.js.sample
Settings = require("./settings.js");

// Connect to the matrix
const theMatrix = new MatrixClientEx(Settings.matrixServerURL, Settings.accessToken);
LogService.setLevel(LogLevel.DEBUG);

roomsToChange=new Map();

function displayProgress(count, total, info)
{
	console.log("%s%: [%s/%s] %s", String(Math.round((count / total)*100)).padStart(3), String(count).padStart(String(total).length), total, info);
}

async function enumerateRooms(modbot, joinedRoomIds)
{
	// Get all the rooms we are in
	if(joinedRoomIds == undefined)
	{
		joinedRoomIds = await theMatrix.getJoinedRooms();
	}

	const totalRoomCount = joinedRoomIds.length;
	let thisRoomCount = 0;
	const stringRoomCount = String(totalRoomCount);

	for(const roomId of joinedRoomIds)
	{
		thisRoomCount++;
		displayProgress(thisRoomCount, totalRoomCount, roomId);

		const roomState = await theMatrix.getRoomState(roomId);
		let powerObj = roomState.find(o => o['type'] === 'm.room.power_levels')['content'];
		// Invite the moderator bot into every room
		// As this is quick-and-dirty this could fail at any point and we'd not really care.
		try
		{

			if(powerObj['users'][Settings.username] == 100)
			{
				let failed = false;
				try
				{
					// TODO:
					// We will get rate-limited and have to deal with it.
					// But no today.
					await theMatrix.inviteUser(modbot, roomId);
				}
				catch(x)
				{
					failed = true;
					console.log("Unable to invite " + modbot + " to " + roomId);
				}
				powerObj['users'][modbot] = 100;
				await setPowerLevelEvent(roomId, powerObj);
			}
		}
		catch(err)
		{
			console.log("Failed");
		}
	}
}

async function setPowerLevelEvent(roomId, powerLevelContent)
{
	await theMatrix.sendStateEvent(roomId, "m.room.power_levels", "", powerLevelContent);
}

const argv = yargs(process.argv.slice(2))
	.usage('Usage: $0 [OPTIONS]')
	.alias('f', 'file')
	.nargs('file', 1)
	.describe('file', 'File containing list of roomIds to work on')
	.alias('m', 'modbot')
	.nargs('modbot', 1)
	.describe('modbot', 'Moderator bot id')
	.argv;

let roomIds = undefined;
if(argv.file)
{
console.log(argv.file);
	roomIds=[];
	for(const roomId of fs.readFileSync(argv.file).toString().split("\n"))
	{
		if((roomId != "") && (roomId[0] != '#'))
			roomIds.push(roomId);
	}
}
if(argv.modbot)
{
	const modbot = argv.modbot;
	console.log("Making " + modbot + " admin in the rooms");
	enumerateRooms(modbot, roomIds);
}
else
{
	console.log("modbot id not specified.");
}


