var express = require('express');
var app = express();
var strava = require('strava-v3');
var request = require('request');
var swig  = require('swig');
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var waterfall = require('async-waterfall');

var athleteId = null;
var athletesCloseBy = [];
var athleteFriends=[];
var totalMatchedAthletes = 0;
var friends = [];
var city = null;
var accessToken = null;

app.engine('html', swig.renderFile);
app.set('view engine', 'html');
app.set('views', __dirname + '/templates');
app.set('view cache', false);

swig.setDefaults({ cache: false });

// @TODO: remove sensetive data in request
// @TODO: ADD THIS BACK IN
const STRAVA_CLIENT_SECRET = '5c60b5c960f0fea81d7d53d9918205e7134f0a32';
const STRAVA_CLIENT_ID = '5615';

app.use('/', express.static(__dirname + '/public'));

server.listen(8088, function () {
	var host = server.address().address;
	var port = server.address().port;

	console.log('Strava app listening at http://%s:%s', host, port);
});

io.on('connection', function (socket) {

	socket.on('accessCode', function (accessCode) {
		var response;
		var formData = {			
			code: accessCode,
			client_id: STRAVA_CLIENT_ID,
			client_secret: STRAVA_CLIENT_SECRET
		};

		// example::
		waterfall([
			function prepareForSearch(done) {
				console.log('called::prepareForSearch::');
				athletesCloseBy = [];
				athleteFriends = [];
				totalMatchedAthletes = 0;
				friends = [];
				city = null;
				accessToken = null;
				done(null, 'Value from step 1'); // <- set value to passed to step 2
			},
			function secondStep(step1Result, done) {
				console.log('called::authenticateAthlete::')
				return request.post({
					url: 'https://www.strava.com/oauth/token',
					formData: formData
				}, function optionalCallback(err, httpResponse, body) {
					if (err) {
						renderErrorResponse(err);
					}
					response = JSON.parse(body);
					athleteId = response.athlete.id;
					accessToken = response.access_token;
					console.log('++', response);
					done(null, athleteId, accessToken); // <- set value to passed to step 3
				});
			},
			function thirdStep(athleteId, accessToken, done) {
				console.log('called::getAthleteFriends::', athleteId, accessToken);
				return function () {
					strava.athlete.get({
						'id': athleteId,
						'access_token': accessToken
					}, function (err, payload) {
						if (!err) {
							console.log(payload);
						} else {
							console.log(err);
						}
					});
				}

				// console.log(step2Result);

				done(null); // <- no value set for the next step.
			}
		],
			function (err) {
				if (err) {
					throw new Error(err);
				} else {
					console.log('No error happened in any steps, operation done!');
				}
			});
			
		// waterfall([
		// 	prepareForSearch(),
		// 	authenticateAthlete(formData),
		// 	getAthleteFriends()
		// ], function (err, result) {
		// 	console.log('async waterfall complete::', err, result);
		// });
	});
});

function authenticateAthlete(formData) {
	console.log('called::authenticateAthlete::')
	return request.post({
			url: 'https://www.strava.com/oauth/token',
			formData: formData
		}, function optionalCallback(err, httpResponse, body) {
			if (err) {
				renderErrorResponse(err);
			}
			response = JSON.parse(body);
			athleteId = response.athlete.id;
			accessToken = response.access_token;
			console.log('++', response);
	});
}

function getAthleteFriends() {
	console.log('called::getAthleteFriends::', athleteId, accessToken);
	return function () {
		strava.athlete.get({
			'id': athleteId,
			'access_token': accessToken
		}, function (err, payload) {
			if (!err) {
				console.log(payload);
			} else {
				console.log(err);
			}
		});
	}
}
/**
 * @description Squares away any previous search info that
 * could skew new result sets
 */
function prepareForSearch () {
	console.log('called::prepareForSearch::');
	athletesCloseBy = [];
	athleteFriends = [];
	totalMatchedAthletes = 0;
	friends = [];
	city = null;
	accessToken = null;
}

/**
 * @description collect all the friends of an athlete
 * and store these in an array
 *
 * @param  {integer} ID
 */
function storeAthletesFriends (callback) {
	console.log('storeAthletesFriends::access_token', accessToken)
	console.log('storeAthletesFriends::id', athleteId);
	strava.athletes.listFriends({
		'access_token': accessToken,
		'id': athleteId
		},function(err, payload) {
		if(!err && apiRequestWithinRateLimit(payload)) {
			console.log('payload::err', err);
			if(athleteWasFound(payload)) {
				payload.forEach(function (athlete, index) {
					athleteFriends.push(athlete.id);
				});

				callback();
			} else {
		   		renderErrorResponse('Athlete was not found on Strava');
			}
			console.log("::: storeAthletesFriends callback", payload);

		} else {
		   renderErrorResponse(err);
		}
	});
}

/**
 * @description For an athlete ID check against Strava that they exist
 *
 * @param  {boolean} result
 */
function athleteWasFound (response) {
	var result = response && response.message || null;

	return (result === 'Record Not Found') ? false : true ; 
}

/**
 * @description For an athlete ID lookup the location
 * and store these in an object
 *
 * @param  {integer} ID
 */
function getAthleteLocationFromId() {

	var athleteLocation = {};

	console.log("::: getAthleteLocationFromId");

	strava.athletes.get({
		"access_token": accessToken,
		"id": athleteId
		},function(err, payload) {
		if(!err && apiRequestWithinRateLimit(payload)) {

			athleteLocation.city = payload.city;
			athleteLocation.state = payload.state;
			athleteLocation.country = payload.country;

			getCoordinatesFromGeoLocation(athleteLocation);
		} else {
		   renderErrorResponse(err);
		}
	});
}

/**
 * @description helper method to check if a request is going to exceed
* the rate limit. If this is the case return a message and stop execusion
 *
 * @param  {objec} payload the API response
 *
 * @returns {object} the lat and long of SE, NW
 */
function apiRequestWithinRateLimit (payload) {

	if(payload && payload.message === "Rate Limit Exceeded") {
		renderErrorResponse("Stravas API rate limit has been exceeded, check back in 15 minutes and try again.");
		return false;
	} else {
		return true;
	}
}

/**
 * @description for a Geo location get the back the SE and NW Lat and Lon
 * To be used to find segments
 *
 * @param  {string} city
 * @param  {string} state
 * @param  {string} Country
 *
 * @returns {object} the lat and long of SE, NW
 */
function getCoordinatesFromGeoLocation (location) {

	console.log("::: getCoordinatesFromGeoLocation", location);

	var geoState = location && location.state && location.state.replace(" ", "+") || "";
	var geoCountry = location && location.country && location.country.replace(" ", "+") || "";
	var coordinates = {};
	var result;

	city = location && location.city && location.city.replace(" ", "+") || "";

	if(!city) {
		renderErrorResponse("you have not told strava where you live. Go to Strava > Settings > Profile and enter your address, then try again.");
	} else {
		request('http://maps.google.com/maps/api/geocode/json?address='+city.toLowerCase()+'+'+geoState.toLowerCase()+'+'+geoCountry.toLowerCase(),
			function (error, response, body) {
			if (!error && response.statusCode === 200) {

				var resp = JSON.parse(body);
				var result = resp && resp.results && resp.results[0] && resp.results[0].geometry && resp.results[0].geometry.viewport || null;

				if(result) {
					coordinates = result;
					getSegmentsForGeoBounds(coordinates);
				} else {
					renderErrorResponse("No location matched. Go to Strava > Settings > Profile and check your address is correct.");
				}
			}
		});
	}
}


/**
 * @description for a Geo location get the back the SE and NW Lat and Lon
 * To be used to find segments
 *
 * @param  {object} SW and NE lat/long in object notation
 */
function getSegmentsForGeoBounds (coordinates) {
	console.log("::: getSegmentsForGeoBounds", coordinates);

	strava.segments.explore({
		"access_token": accessToken,
		'bounds': coordinates.southwest.lat+','+coordinates.southwest.lng+','+coordinates.northeast.lat+','+coordinates.northeast.lng
	},function(err,payload) {
	    if(!err && apiRequestWithinRateLimit(payload)) {
	        if(payload.segments.length > 0) {
		        payload.segments.forEach(function (item) {
		        	lookupAthletesForSpecifiedSegment(item.id);
		        });

	        } else {
	        	renderErrorResponse("No Strava segments were found near your location, that sucks..");
	        }
	    } else {
	        renderErrorResponse(err);
	    }
	});
}

/**
 * @description for a segment lookup the leaderboard of
 * atheletes that have scrored on this
 *
 * @param  {integer} segmentId
 */
function lookupAthletesForSpecifiedSegment (segmentId) {

	console.log("::: lookupAthletesForSpecifiedSegment", segmentId);

	strava.segments.listLeaderboard({
		"access_token": accessToken,
		"id": segmentId,
		"gender": "M",
		"following": false,
		"page": 1
	},function(err,payload) {

		if(!err && apiRequestWithinRateLimit(payload)) {
		    if(payload.entries.length > 0) {
		    	payload.entries.forEach(function (item, i) {
					filterAthletesBasedOnAddress(item.athlete_id);
		    	});
			}
		}
		else {
		   renderErrorResponse(err);
		}
	});
}

/**
 * @description for a given Athlete add them to a list of athletes
 * if they live in the same location as specified
 *
 * @param {integer} athleteId
 */
function filterAthletesBasedOnAddress (athleteIdentifier) {

	console.log("::: filterAthletesBasedOnAddress", athleteIdentifier, athleteId);

	if(athleteIdentifier) {
		// Remove duplicate athletes
		if(athletesCloseBy.indexOf(athleteIdentifier) !== -1 ||
			athleteFriends.indexOf(athleteId) !== -1 ||
		 	athleteIdentifier == athleteId) {

			return false;
		}

		athletesCloseBy.push(athleteIdentifier);

		strava.athletes.get({
			"access_token": accessToken,
			"id": athleteIdentifier
		},function(err,payload) {
		    if(!err && apiRequestWithinRateLimit(payload)) {

		    	var athleteCity = payload && payload.city && payload.city.toLowerCase().replace(" ", "+") || "";

		    	if(athleteCity) {
		    		if(athleteCity.replace("'","") === city.toLowerCase().replace("'","")) {

						var fullName = payload.firstname +" "+ payload.lastname;
						var location = cleanLocation(athleteCity, payload.state);
						var picture = payload.profile;

						totalMatchedAthletes += 1;
						updateTotals(totalMatchedAthletes);
						renderAdvert(totalMatchedAthletes);

						renderFriend({
							"id": payload.id,
							"profile": picture,
							"name": fullName,
							"location": location,
							"premium": payload.premium
						});

					}
				}
			} else {
				renderErrorResponse(err);
			}
		});
	}
}

/**
 * @description Cleans up the display location for an athlete
 *
 * @param {string} city
 * @param {string} state
 */
function cleanLocation(city, state) {
	var cleanCity = city && city.replace('+', ' ') || '';
	var cleanState = state && state.replace('+', ' ') || '';

	return cleanCity + ' ' + cleanState;	
}

/**
 * @description Returns an updated title string including totals counts
 *
 * @param {integer} total
 */
function updateTotals(total) {
	var plural = (total > 1) ? 's': '';
	var heading = "Found " + total + " athlete" + plural +" nearby";

	io.emit('update', {
		html: heading
	});
}

/**
 * @description render a successful response
 * back to the app for an individual athlete
 *
 * @param {object} friend information on local athlete
 */

function renderFriend (friend) {
	var tpl = swig.renderFile(__dirname + '/templates/friend.html', {
		results: friend
	});

	io.emit('result', {
		html: tpl
	});
}

/**
 * @description renders an advert into the result set, on the following conditions:
 * - Results must have been retured
 * - No adverts have already been displayed
 *
 * @param {Integer} count number of athletes added to DOM 
 *
 */
function renderAdvert (count) {

	if(count % 11 == 0) {
		var tpl = swig.renderFile(__dirname + '/templates/advert.html');

		io.emit('result', {
			html: tpl
		});
	}

}

/**
 * @description render an error handler response
 * back to the app
 *
 * @param {string} error information pertaining to the failure
 */
function renderErrorResponse (error) {
	console.log(error);
	var heading = "Something went wrong";
	var errorDescription = error;
	var tpl = swig.renderFile(__dirname + '/templates/error.html', {
		title: heading,
		error: errorDescription
	});

	io.emit('error', {
		html: tpl
	});

	return false;
}
