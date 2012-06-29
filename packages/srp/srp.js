(function () {

  var Nstr = "115b8b692e0e045692cf280b436735c77a5a9e8a9e7ed56c965f87db5b2a2ece3";
  var N = new Meteor._BigInteger(Nstr, 16);
  var g = new Meteor._BigInteger("2");
  var k = new Meteor._BigInteger("c46d46600d87fef149bd79b81119842f3c20241fda67d06ef412d8f6d9479c58", 16); // XXX this is probably wrong!

  var H = Meteor._SHA256;
  var randInt = function () {
    return new Meteor._BigInteger(Meteor.uuid().replace(/-/g, ''), 16);
  };

  /////// CLIENT

  Meteor._XXX_client = function (username, password) {
    var self = this;

    self.username = username;
    self.password = password;
  };

  // create new verifier
  // returns obj w/ salt, vkey, etc.
  Meteor._XXX_client.prototype.create = function () {
    var self = this;

    var salt = Meteor.uuid(); // XXX
    var x = H(salt + H(self.username + ":" + self.password));
    var xi = new Meteor._BigInteger(x, 16);
    var v = g.modPow(xi, N);

    return {
      username: self.username,
      salt: salt,
      vkey: v.toString(16)
    };
  };

  // reset everything. return a request (u, A)
  Meteor._XXX_client.prototype.start = function () {
    var self = this;

    var a, A;
    while (!A || A.mod(N) === 0) {
      a = randInt();
      A = g.modPow(a, N);
    }

    self.a = a;
    self.A = A;
    self.Astr = A.toString(16);

    return {
      username: self.username,
      A: self.Astr
    };
  };

  // process the challenge and respond
  Meteor._XXX_client.prototype.respond = function (challenge) {
    var self = this;

    self.Bstr = challenge.B;
    self.B = new Meteor._BigInteger(self.Bstr, 16);
    if (self.B.mod(N) === 0)
      throw new Error("XXX");

    self.salt = challenge.salt;

    var u = new Meteor._BigInteger(H(self.Astr + self.Bstr), 16);
    var x = new Meteor._BigInteger(
      H(self.salt + H(self.username + ":" + self.password)), 16);

    var kgx = k.multiply(g.modPow(x, N));
    var aux = self.a.add(u.multiply(x));
    var S = self.B.subtract(kgx).modPow(aux, N);
    var M = H(self.Astr + self.Bstr + S.toString(16));
    var HAMK = H(self.Astr + M + S.toString(16));

    self.S = S;
    self.HAMK = HAMK;

    return {
      M: M
    };
  };

  // returns true or false
  Meteor._XXX_client.prototype.verify = function (confirmation) {
    var self = this;

    return (confirmation.HAMK === self.HAMK);
  };



  /////// SERVER


  Meteor._XXX_server = function (verifier) {
    var self = this;

    self.verifier = verifier;
  };

  // get a challenge (s, B)
  Meteor._XXX_server.prototype.challenge = function (request) {
    var self = this;

    // XXX this indicates api mismatch?
    if (request.username !== self.verifier.username)
      throw new Error("XXX");

    self.Astr = request.A;
    self.A = new Meteor._BigInteger(self.Astr, 16);
    if (self.A.mod(N) === 0)
      throw new Error("XXX");

    var v = new Meteor._BigInteger(self.verifier.vkey, 16);

    var b, B;
    while (!B || B.mod(N) === 0) {
      b = randInt();
      B = k.multiply(v).add(g.modPow(b, N)).mod(N);
    }

    self.b = b;
    self.B = B;
    self.Bstr = B.toString(16);

    return {
      salt: self.verifier.salt,
      B: self.Bstr
    };
  };

  // returns a confirmation
  Meteor._XXX_server.prototype.verify = function (response) {
    var self = this;

    var u = new Meteor._BigInteger(H(self.Astr + self.Bstr), 16);
    var v = new Meteor._BigInteger(self.verifier.vkey, 16);
    var avu = self.A.multiply(v.modPow(u, N));
    var S = avu.modPow(self.b, N);
    var M = H(self.Astr + self.Bstr + S.toString(16));

    var HAMK = H(self.Astr + M + S.toString(16));

    if (response.M !== M)
      return null;

    return {
      HAMK: HAMK
    };
  };

})();
