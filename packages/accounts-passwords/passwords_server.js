(function () {

  // internal verifier collection. Never published.
  Meteor.accounts._srpChallenges = new Meteor.Collection(
    "accounts._srpChallenges",
    null /*manager*/,
    null /*driver*/,
    true /*preventAutopublish*/);


  Meteor.methods({
    beginSrp: function (request) {
      var username = request.username;
      if (!username)
        throw new Meteor.Error("must provide a username");

      var user = Meteor.users.findOne({username: username});
      if (!user || !user.services || !user.services.srp)
        throw new Meteor.Error("user not found");
      var verifier = user.services.srp;

      var srp = new Meteor._XXX_server(verifier);
      var challenge = srp.challenge(request);

      var srp_serial = srp.serialize();
      srp_serial.userId = user._id;
      Meteor.accounts._srpChallenges.insert(srp_serial);

      return challenge;
    }
  });


  // handler to login with password
  Meteor.accounts.registerLoginHandler(function (options) {
    if (!options.srp)
      return undefined; // don't handle

    // XXX restore challenge
    var srp_serial = Meteor.accounts._srpChallenges.findOne(
      {A: options.srp.A});
    if (!srp_serial)
      throw new Meteor.Error("unknown challenge");

    var srp = Meteor._XXX_server.unserialize(srp_serial);
    var confirmation = srp.verify(options.srp);

    if (!confirmation)
      throw new Meteor.Error("bad password");

    var userId = srp_serial.userId;
    var loginToken = Meteor.accounts._loginTokens.insert({userId: userId});

    return {token: loginToken, id: userId, srp: confirmation};
  });


  // handler to login with a new user
  Meteor.accounts.registerLoginHandler(function (options) {
    if (!options.newUser)
      return undefined; // don't handle

    if (!options.newUser.username)
      throw new Meteor.Error("need to set a username");
    var username = options.newUser.username;

    if (Meteor.users.findOne({username: username}))
      throw new Meteor.Error("user already exists");

    // XXX validate verifier

    // XXX use updateOrCreateUser

    var user = {username: username, services: {srp: options.newUser.verifier}};
    var userId = Meteor.users.insert(user);

    var loginToken = Meteor.accounts._loginTokens.insert({userId: userId});

    return {token: loginToken, id: userId};
  });



})();
