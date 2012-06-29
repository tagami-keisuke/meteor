Package.describe({
  summary: "XXX SRP LIB",
  internal: true
});

Package.on_use(function (api) {
  api.add_files(['biginteger.js', 'sha256.js', 'srp.js'],
                ['client', 'server']);
});

Package.on_test(function (api) {
  api.use('srp', ['client', 'server']);
  api.add_files(['srp_tests.js'], ['client', 'server']);
});
