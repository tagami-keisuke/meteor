(function () {

  // XXX options to add to new user
  // XXX callback
  Meteor.loginNewUser = function (username, password) {
    var srp = new Meteor._XXX_client(username, password);
    var verifier = srp.create();

    Meteor.apply('login', [
      {newUser: {username: username, verifier: verifier}}
    ], {wait: true}, function (error, result) {
      if (error) {
        console.log(error);
        // XXX this hides the error! and we do it other places in auth
        throw error;
      }

      if (!result) {
        return;
      } else {
        Meteor.accounts.makeClientLoggedIn(result.id, result.token);
      }
    });

  };

  Meteor.loginWithPassword = function (username, password) {
    var srp = new Meteor._XXX_client(username, password);
    var request = srp.start();

    Meteor.apply('beginSrp', [request], function (error, result) {
      if (error) {
        console.log(error);
        // XXX this hides the error! and we do it other places in auth
        throw error;
      }

      var response = srp.respond(result);
      Meteor.apply('login', [
        {srp: response}
      ], {wait: true}, function (error, result) {
        if (error) {
          console.log(error);
          // XXX this hides the error! and we do it other places in auth
          throw error;
        }

        if (!result) {
          return;
        }

        if (!srp.verify(result.srp)) {
          console.log('no verify!');
          throw new Meteor.Error("server is cheating!");
        }

        Meteor.accounts.makeClientLoggedIn(result.id, result.token);

      });
    });
  };
})();
