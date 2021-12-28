const {MatrixClient, LogService, LogLevel, UserID} = require("matrix-bot-sdk");

// Load credentials - see accesstoken.js.sample
Creds = require("./accesstoken.js");

// Connect to the matrix
const theMatrix = new MatrixClient(Creds.matrixServerURL, Creds.accessToken);
LogService.setLevel(LogLevel.DEBUG);

function isValidRoomToChange(roomObj)
{
	if(!roomObj.createObj || !roomObj.nameObj)
		return false;

	return roomObj.createObj['content']['creator'] === Creds.username;
}

async function changeRoom(roomObj)
{
	console.log(roomObj.roomId);
	console.log(roomObj.nameObj);
	console.log(roomObj.aliasObj);
	console.log(roomObj.createObj);
}

async function enumerateRooms()
{
	// Get all the rooms we are in
	const joinedRoomIds = await theMatrix.getJoinedRooms();

	for(const roomId of joinedRoomIds)
	{
		// Get the state of each room.
		roomObj={roomId: roomId};

		const stateObj = await theMatrix.getRoomState(roomId);
		roomObj.nameObj = stateObj.find(o => o['type'] === 'm.room.name');
		roomObj.aliasObj = stateObj.find(o => o['type'] === 'm.room.canonical_alias');
		roomObj.createObj = stateObj.find(o => o['type'] === 'm.room.create');

		if(isValidRoomToChange(roomObj))
		{
			changeRoom(roomObj);
		}
	}
}

enumerateRooms();

console.log("Done!");

