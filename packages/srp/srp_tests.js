(function() {
  var username = "I'm a User!";
  var good_password = "asdfjkl;";
  var bad_password = "guess again";

  var verifier = (new Meteor._XXX_client(username, good_password)).create();


  Tinytest.add("srp - good", function(test) {
    var C = new Meteor._XXX_client(username, good_password);
    var S = new Meteor._XXX_server(verifier);

    var request = C.start();
    var challenge = S.challenge(request);
    var response = C.respond(challenge);
    var confirmation = S.verify(response);

    test.isTrue(confirmation);
    test.isTrue(C.verify(confirmation));
  });

  Tinytest.add("srp - bad pw", function(test) {
    var C = new Meteor._XXX_client(username, bad_password);
    var S = new Meteor._XXX_server(verifier);

    var request = C.start();
    var challenge = S.challenge(request);
    var response = C.respond(challenge);
    var confirmation = S.verify(response);

    test.isFalse(confirmation);
  });

})();
