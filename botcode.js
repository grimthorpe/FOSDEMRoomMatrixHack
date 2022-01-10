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

function isValidRoomToChange(roomObj)
{
	if(!roomObj.createObj || !roomObj.nameObj)
		return false;

	// Do not change Spaces
	if(roomObj.createObj['content']['type'] === 'm.space')
		return false;

	// Check if the room creator matches
	return roomObj.createObj['content']['creator'] === Settings.username;
}

// Add or replace the prefix on a name or alias.
// Used so that we can run the script multiple times and not get repeated prefixes.
function addOrReplacePrefix(name, prefixSeperator)
{
	const pos = name.indexOf(prefixSeperator)
	if(pos >= 0)
	{
		// Check if our prefix lengths match.
		if(pos == Settings.targetPrefix.length)
		{
			const s = name.substring(0, pos);
			// Dirty check for numeric value - parse the string as an integer and then check if that matches with the original string.
			if(parseInt(s) == s)
			{
				name=name.substr(pos + prefixSeperator.length);
			}
		}
	}

	return Settings.targetPrefix + prefixSeperator + name;
}

function addOrReplacePrefixForName(name)
{
	return addOrReplacePrefix(name, ": ");
}

function addOrReplacePrefixForAlias(alias)
{
	return '#' + addOrReplacePrefix(alias.substr(1), '-');
}

function addRoomToChange(roomObj)
{
	const oldRoomName = roomObj.nameObj['content']['name'],
	changeData =
	{
		oldRoomName: oldRoomName,
		newRoomName: addOrReplacePrefixForName(oldRoomName),
	}
	
	if(roomObj.aliasObj)
	{
		const oldCanonicalAlias = roomObj.aliasObj['content']['alias'];
		const oldAliasList = roomObj.aliasObj['content']['alt_aliases'];

		if(oldCanonicalAlias)
		{
			changeData.oldCanonicalAlias = oldCanonicalAlias;
			changeData.newCanonicalAlias = addOrReplacePrefixForAlias(oldCanonicalAlias);
			changeData.addCanonicalAlias = true;
		}
		if(oldAliasList)
		{
			// NOTE: The alias list only contains PUBLISHED aliases.
			let newAliasList=[];
			let canonicalAliasFound=false;
			for(const alias of oldAliasList)
			{
				if(alias === oldCanonicalAlias)
					canonicalAliasFound = true;
				newAliasList[newAliasList.length]=addOrReplacePrefixForAlias(alias);
			}
			changeData.addCanonicalAlias = !canonicalAliasFound;
			changeData.oldAliasList = oldAliasList;
			changeData.newAliasList = newAliasList;
		}
	}

	// Find the Space that the room is in (if any).
	changeData.moveSpace = !roomObj.isInTargetSpace;
	if(roomObj.parentObj)
	{
		changeData.parent = roomObj.parentObj['state_key'];
	}

	changeData.powerLevels = roomObj.powerObj['content'];
	roomsToChange.set(roomObj.roomId, changeData);
}

async function enumerateRooms(joinedRoomIds)
{
	// Get all the rooms we are in
	if(joinedRoomIds == undefined)
	{
		joinedRoomIds = await theMatrix.getJoinedRooms();
	}

	const totalRoomCount = joinedRoomIds.length;
	let thisRoomCount = 0;
	const stringRoomCount = String(totalRoomCount);

	const spaceObj = await theMatrix.getRoomState(Settings.targetSpace);

	for(const roomId of joinedRoomIds)
	{
		thisRoomCount++;
		displayProgress(thisRoomCount, totalRoomCount, roomId);
		// Get the state of each room.
		roomObj={roomId: roomId};

		const stateObj = await theMatrix.getRoomState(roomId);
		const spaceChildObj = spaceObj.find(o => (o['type'] === 'm.space.child') && (o['state_key'] === roomId) && (o['content']['via']));
		roomObj.isInTargetSpace = spaceChildObj != undefined;
		roomObj.parentObj = stateObj.find(o => o['type'] === 'm.space.parent');
		roomObj.nameObj = stateObj.find(o => o['type'] === 'm.room.name');
		roomObj.aliasObj = stateObj.find(o => o['type'] === 'm.room.canonical_alias');
		roomObj.createObj = stateObj.find(o => o['type'] === 'm.room.create');
		roomObj.powerObj = stateObj.find(o => o['type'] === 'm.room.power_levels');
		
		if(isValidRoomToChange(roomObj))
		{
			addRoomToChange(roomObj);
		}
	}

	try
	{
		await updateRooms();
	}
	catch(err)
	{
		console.log(err);
	}
}

async function setRoomName(roomId, newName)
{
	setRoomNameEvent =
	{
		"name": newName,
	}

	await theMatrix.sendStateEvent(roomId, "m.room.name", "", setRoomNameEvent);
}

async function setRoomAliases(roomId, canonicalAlias, aliasList)
{
//Disable the call to getRoomAliases because it is rate-limited, and we don't do anything to limit our calls.
//console.log(await theMatrix.getRoomAliases(roomId));
	setCanonicalAliasEvent = {}
	if(canonicalAlias)
	{
		setCanonicalAliasEvent["alias"] = canonicalAlias;
	}
	if(aliasList)
	{
		setCanonicalAliasEvent["alt_aliases"] = aliasList;
	}
	await theMatrix.sendStateEvent(roomId, "m.room.canonical_alias", "", setCanonicalAliasEvent);
}

async function modifyRoomAliases(roomId, oldAliasList, newAliasList)
{
	let changed = false;
	for(let i = 0; i < oldAliasList.length; i++)
	{
		if(oldAliasList[i] != newAliasList[i])
		{
			try
			{
				await theMatrix.createRoomAlias(newAliasList[i], roomId);
			}
			catch(err) {}
			await theMatrix.deleteRoomAlias(oldAliasList[i]);
			changed = true;
		}
	}
	return changed;
}

async function setSpaceChild(roomId, childId, via)
{
	setSpaceChildEvent = {};
	if(via)
		setSpaceChildEvent["via"] = via;

	await theMatrix.sendStateEvent(roomId, "m.space.child", childId, setSpaceChildEvent);
}

async function setSpaceParent(roomId, parentId, via)
{
	setSpaceParentEvent =
	{
		"via": via,
		"canonical": true,
	}

	await theMatrix.sendStateEvent(roomId, "m.space.parent", parentId, setSpaceParentEvent);
}

async function setPowerLevelEvent(roomId, powerLevelContent)
{
	await theMatrix.sendStateEvent(roomId, "m.room.power_levels", "", powerLevelContent);
}

async function updateRoom(roomId, roomData)
{
	let retryCount = 5;
	let done = false;
	do
	{
		try
		{
			if(roomData.oldRoomName != roomData.newRoomName)
			{
				await setRoomName(roomId, roomData.newRoomName);
			}

			let aliasesChanged = false;
			if(roomData.newAliasList)
				aliasesChanged |= await modifyRoomAliases(roomId, roomData.oldAliasList, roomData.newAliasList);

			if(roomData.addCanonicalAlias)
			{
				aliasesChanged |= await modifyRoomAliases(roomId, [roomData.oldCanonicalAlias], [roomData.newCanonicalAlias]);
				roomData.newAliasList[roomData.newAliasList.length] = roomData.newCanonicalAlias;
			}

			if(roomData.newCanonicalAlias && aliasesChanged)
			{
				await setRoomAliases(roomId, roomData.newCanonicalAlias, roomData.newAliasList);
			}

			if(roomData.moveSpace)
			{
				await setSpaceChild(Settings.targetSpace, roomId, Settings.targetVia);
				await setSpaceParent(roomId, Settings.targetSpace, Settings.targetVia);
				if(Settings.removeRoomFromOldSpace && roomData.parent && (roomData.parent != Settings.targetSpace))
				{
					// Remove from existing parent.
					await setSpaceChild(roomData.parent, roomId, undefined);
				}
			}

			if(roomData.powerLevels['events_default'] != 50)
			{
				roomData.powerLevels['events_default'] = 50;
				await setPowerLevelEvent(roomId, roomData.powerLevels);
			}
			done = true;
		}
		catch(err)
		{
			console.log("Error occurred updating Room %s (%s)", roomData.oldRoomName, roomId);
			if(retryCount-- <= 0)
			{
				if(!readline.keyInYN("Do you want to continue to the next Room?"))
				{
					throw "Aborted by user";
				}
				done = true;
			}
			else
			{
				console.log("Retrying.");
				// Wait for 2 seconds before retrying
				await new Promise(r => setTimeout(r, 2000));
			}
		}
	}
	while(!done);
}

function displayRoomData(roomId, roomData)
{
	console.log("Room Id: %s", roomId);
	console.log("Name: '%s' -> '%s'", roomData.oldRoomName, roomData.newRoomName);
	if(roomData.oldCanonicalAlias)
		console.log("Main Alias: '%s' -> '%s'", roomData.oldCanonicalAlias, roomData.newCanonicalAlias);
	if(roomData.oldAliasList)
	{
		console.log("Alias changes:");
		for(let i = 0; i < roomData.oldAliasList.length; i++)
		{
			console.log("  '%s' -> '%s'", roomData.oldAliasList[i], roomData.newAliasList[i]);
		}
	}
	if(roomData.parent)
		console.log("Parent space: '%s' -> '%s'", roomData.parent, Settings.targetSpace);
	else
		console.log("Parent space: <NONE> -> '%s'", Settings.targetSpace);

	console.log();
}


async function updateRooms()
{
	console.log();
	console.log("Found %d rooms to change.", roomsToChange.size);
	console.log("Proposed Changes:");
	console.log();

	// Display the list of proposed changes
	roomsToChange.forEach(function(roomData, roomId) { displayRoomData(roomId, roomData); })

	if(readline.keyInYN("Do you want to set this?"))
	{
		let count = 1;
		let totalCount = roomsToChange.size;

		for(const [roomId, roomData] of roomsToChange.entries())
		{
			displayProgress(count++, totalCount, roomId + " - " + roomData.oldRoomName + " -> " + roomData.newRoomName);
			await updateRoom(roomId, roomData);
		}
	}
	else
	{
		throw "Aborted by user";
	}
}

const argv = yargs(process.argv.slice(2))
	.usage('Usage: $0 [OPTIONS]')
	.alias('f', 'file')
	.nargs('file', 1)
	.describe('file', 'File containing list of roomIds to work on')
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

enumerateRooms(roomIds);

