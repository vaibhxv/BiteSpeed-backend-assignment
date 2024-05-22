const _ = require('lodash')
var express = require('express');
var router = express.Router();
const { userModel } = require('../models/user');
const { ObjectId } = require('mongodb');
const { InvalidInputError } = require('../error-handlers/errors')

String.prototype.hashCode = function () {
  var hash = 0;
  if (this.length == 0) {
    return hash;
  }
  for (var i = 0; i < this.length; i++) {
    var char = this.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

const formatOutput = (array) => {
  const phoneNumbers = [];
  const emails = [];
  const secondaryContactIds = [];
  let primaryContatctId = null;
  
  array.forEach((item) => {
    const { id } = item;
    const { phoneNumber, email, linkPrecedence } = item;
    phoneNumbers.push(phoneNumber);
    emails.push(email);
    if (linkPrecedence === 'primary') primaryContatctId = id
    else secondaryContactIds.push(id);
  });
  return {
    primaryContatctId,
    secondaryContactIds,
    emails: _.uniq(emails),
    phoneNumbers: _.uniq(phoneNumbers),
  };
}

function isValidEmail(email) {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
}

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Identity Reconciliation' });
});

router.get('/identify', function (req, res, next) {
  res.render('identify', { title: 'Express' });
});
async function getContact({ email, phoneNumber }) {
  const emailUsers = await userModel.find({ email });
  const phoneNumbers = [];
  emailUsers.forEach((user) => {
    phoneNumbers.push(user.phoneNumber);
  });
  phoneNumbers.push(phoneNumber);
  const users = await userModel.find({ phoneNumber: { $in: phoneNumbers } });
  return users;
}

router.post('/identify_old', async function (req, res, next) {
  const { email, phoneNumber: inputPhoneNumber } = req.body;
  try {
    let phoneNumber = null;
    if (!isValidEmail(email)) throw new InvalidInputError('invalid email', 400);
    if (inputPhoneNumber) phoneNumber = inputPhoneNumber.trim();
    if (!phoneNumber || phoneNumber === '') throw new InvalidInputError('invalid phoneNumber', 400);
    let user = await userModel.findOne({ email, phoneNumber });
    if (user) {
      const contact = await getContact({ email, phoneNumber });
      res.send({ contact: formatOutput(contact) });
    }
    else {
      const existingEntry = await userModel.find({ $or: [{ email }, { phoneNumber }], linkPrecedence: 'primary' });
      let existingPhoneNumberPrimary = null;
      let existingEmailPrimary = null;

      existingEntry.forEach((entry) => {
        if (entry.email === email) {
          existingEmailPrimary = entry;
        }
        if (entry.phoneNumber === phoneNumber) {
          existingPhoneNumberPrimary = entry;
        }
      });
      let filter = {};
      let update = {};
      let create = true;
      if (existingEmailPrimary && existingPhoneNumberPrimary) {
        filter = { $or: [{ email: existingPhoneNumberPrimary.email }, { phoneNumber: existingPhoneNumberPrimary.phoneNumber }] };
        update = { $set: { linkPrecedence: 'secondary', linkedId: existingEmailPrimary.id, updatedAt: new Date() } };
        create = false;
      }
      const primaryUser = existingEmailPrimary || existingPhoneNumberPrimary;
      await userModel.updateMany(filter, update);

      if (create) {
        const objectId = new ObjectId();
        const id = objectId.toString().hashCode();
        user = new userModel({
          id,
          phoneNumber,
          email,
          linkPrecedence: primaryUser ? 'secondary' : 'primary',
          linkedId: primaryUser ? primaryUser.id : null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        });
        await user.save();
      }
      const contact = await getContact({ email, phoneNumber });
      res.send({ contact: formatOutput(contact) });
    }
  } catch (err) {
    res.send({ err });
  }
});

async function getExistingUsers(user) {
  const { linkedId, id } = user;
  console.log({ linkedId, id });
  let filter = [];
  if (!linkedId) {
    filter = [{ linkedId: id }, { id }];
  } else {
    filter = [{ linkedId }, { id: linkedId }];
  }
  return userModel.find({ $or: filter });
}

router.post('/identify', async function (req, res, next) {
  const { email, phoneNumber: inputPhoneNumber } = req.body;
  try {
    let phoneNumber = null;
    if (!isValidEmail(email)) throw new InvalidInputError('invalid email', 400);
    if (inputPhoneNumber) phoneNumber = inputPhoneNumber.trim();
    if (!phoneNumber || phoneNumber === '') throw new InvalidInputError('invalid phoneNumber', 400);
    let user = await userModel.findOne({ email, phoneNumber });
    if (user) {
      const users = await getExistingUsers(user);
      res.send({ contact: formatOutput(users) });
    } else {
      const sameEmailUser = await userModel.findOne({ email });
      const sameNumberUser = await userModel.findOne({ phoneNumber });
      let createNewUser = true;
      const objectId = new ObjectId();
      const id = objectId.toString().hashCode();
      const newUser = {
        id,
        phoneNumber,
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      if (!sameEmailUser && !sameNumberUser) {
        newUser.linkPrecedence = 'primary';
        newUser.linkedId = null;
      }
      if (sameEmailUser && !sameNumberUser) {
        newUser.linkPrecedence = 'secondary';
        newUser.linkedId = sameEmailUser.linkedId || sameEmailUser.id;
      }
      if (!sameEmailUser && sameNumberUser) {
        newUser.linkPrecedence = 'secondary';
        newUser.linkedId = sameNumberUser.linkedId || sameNumberUser.id;
      }
      if (sameEmailUser && sameNumberUser) {
        createNewUser = false;
        const emailPrimaryId = sameEmailUser.linkedId || sameEmailUser.id;
        const numberPrimaryId = sameNumberUser.linkedId || sameNumberUser.id;
        if (emailPrimaryId !== numberPrimaryId) {
          await userModel.updateMany({ $or: [{ linkedId: numberPrimaryId}, { id: numberPrimaryId }] }, {
            $set: {
              linkedId: emailPrimaryId, linkPrecedence: 'secondary', updatedAt: new Date(),
            }
          });
        }
        newUser.linkPrecedence = 'secondary';
        newUser.linkedId = sameEmailUser.linkedId || sameEmailUser.id;
      }
      if (createNewUser) {
        const user  = new userModel(newUser);
        await user.save();
      }
      const users = await getExistingUsers(newUser);
      res.send({ contact: formatOutput(users) });
    }
  } catch (err) {
    res.send({ err });
  }
});

module.exports = router;
