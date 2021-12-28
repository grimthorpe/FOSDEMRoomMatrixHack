const {MatrixClient, LogService, LogLevel, UserID} = require("matrix-bot-sdk");

// Load credentials - see accesstoken.js.sample
Creds = require("./accesstoken.js");

// Connect to the matrix
const theMatrix = new MatrixClient(Creds.matrixServerURL, Creds.accessToken);
LogService.setLevel(LogLevel.DEBUG);

async function enumerateRooms()
{
	// Get all the rooms we are in
	const joinedRoomIds = await theMatrix.getJoinedRooms();

	for(const roomId of joinedRoomIds)
	{
		// Get the state of each room.
		const stateObj = await theMatrix.getRoomState(roomId);
		const nameObj = stateObj.find(o => o['type'] === 'm.room.name');
		const aliasObj = stateObj.find(o => o['type'] === 'm.room.canonical_alias');
		console.log(nameObj);
		console.log(aliasObj);
		console.log("");
	}
}

enumerateRooms();

console.log("Done!");

