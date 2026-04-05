const fs = require("fs")

const startTime = Date.now()

function getUptime() {
  const total = Math.floor((Date.now() - startTime) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}j ${m}m ${s}d`
}

// ======================
// LOAD DATABASE
// ======================
let db
try {
  db = JSON.parse(fs.readFileSync("./database.json"))
} catch {
  db = {}
}

if (!db.owners)        db.owners        = []
if (!db.allowedUsers)  db.allowedUsers  = []
if (!db.linkPS)        db.linkPS        = ""
if (!db.promosi)       db.promosi       = ""
if (!db.groupSettings) db.groupSettings = {}
if (!db.jadwal)        db.jadwal        = []

db.owners       = [...new Set(db.owners)]
db.allowedUsers = [...new Set(db.allowedUsers)]

const saveDB = () => {
  db.owners       = [...new Set(db.owners)]
  db.allowedUsers = [...new Set(db.allowedUsers)]
  fs.writeFileSync("./database.json", JSON.stringify(db, null, 2))
}

saveDB()

// ======================
// SCHEDULER (cek setiap menit)
// ======================
let sockGlobal = null

setInterval(async () => {
  if (!sockGlobal) return
  if (!db.jadwal || db.jadwal.length === 0) return

  const now   = new Date()
  const jam   = String(now.getHours()).padStart(2, "0")
  const menit = String(now.getMinutes()).padStart(2, "0")
  const waktuSekarang = `${jam}:${menit}`

  for (const j of db.jadwal) {
    if (j.waktu !== waktuSekarang) continue
    // Cegah kirim 2x dalam menit yang sama
    if (j.lastSent === waktuSekarang) continue

    try {
      await sockGlobal.sendMessage(j.groupId, { text: `📅 *Pesan Terjadwal*\n\n${j.pesan}` })
      j.lastSent = waktuSekarang
      saveDB()
    } catch (e) {
      console.log("Gagal kirim jadwal:", e.message)
    }
  }
}, 60 * 1000)

// ======================
// HELPER: ambil/init setting per grup
// ======================
function getGS(gid) {
  if (!db.groupSettings[gid]) {
    db.groupSettings[gid] = {
      antilink: false,
      welcome:  "",
      bye:      ""
    }
    saveDB()
  }
  if (db.groupSettings[gid].antilink === undefined) db.groupSettings[gid].antilink = false
  return db.groupSettings[gid]
}

// ======================
// HELPER: normalisasi nomor WA
// ======================
function normNum(jid) {
  return jid.replace(/[^0-9]/g, "").replace(/^0/, "62")
}

// ======================
// HANDLER
// ======================
module.exports = async (sock, msg) => {
  try {
    sockGlobal = sock
    const from   = msg.key.remoteJid
    const sender = msg.key.participant || msg.key.remoteJid
    const senderNumber = normNum(sender.split("@")[0])

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text

    const text    = body ? body.toLowerCase() : ""
    const isGroup = from.endsWith("@g.us")

    // ======================
    // GROUP DATA
    // ======================
    let groupMetadata = isGroup ? await sock.groupMetadata(from) : {}
    let participants  = isGroup ? groupMetadata.participants : []
    let groupAdmins   = isGroup
      ? participants.filter(v => v.admin !== null).map(v => v.id)
      : []

    const isAdmin   = groupAdmins.some(a => normNum(a.split("@")[0]) === senderNumber)
    const isOwner   = db.owners.map(normNum).includes(senderNumber)
    const isAllowed = isAdmin || isOwner || db.allowedUsers.map(normNum).includes(senderNumber)

    // ======================
    // ANTILINK (otomatis)
    // ======================
    if (isGroup && !isAdmin && !isOwner) {
      const gs = getGS(from)

      if (gs.antilink) {
        const allText = [
          msg.message?.conversation,
          msg.message?.extendedTextMessage?.text,
          msg.message?.imageMessage?.caption,
          msg.message?.videoMessage?.caption,
        ].filter(Boolean).join(" ")

        const hasWALink = /chat\.whatsapp\.com|wa\.me|whatsapp\.com\/channel|whatsapp\.com\/newsletter/i.test(allText)

        if (hasWALink) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: sender }
            })
          } catch (e) { console.log("Gagal hapus:", e.message) }

          sock.sendMessage(from, {
            text: `⚠️ @${senderNumber} dilarang mengirim link WhatsApp!`,
            mentions: [sender]
          })
          return
        }
      }
    }


    // ======================
    // MENU
    // ======================
    if (text === ".menu") {
      const uptime = getUptime()
      const linkps = db.linkPS || "Belum diset"
      let statusAnti = ""
      if (isGroup) {
        const gs = getGS(from)
        statusAnti = `\n│ 🔗 Antilink: ${gs.antilink ? "✅ ON" : "❌ OFF"}`
      }

      return sock.sendMessage(from, {
        text: `
╭─❖「 *MENU BOT* 」❖
│ ⏱️ Uptime: ${uptime}
│ 🔗 Link PS: ${linkps}${statusAnti}
│
│ 📢 .linkps  (publick)
│
├─❖「 *ADMIN & OWNER* 」
│ ⚙️ .kick (reply/tag)
│ 🗑️ .del (reply)
│ 🔓 .open
│ 🔒 .close
│ 🔗 .setlinkps <link>
│ 📣 .promosi
│ 📣 .setpromosi <teks>
│
│ 👋 .setwelcome <teks>
│ 👋 .setbye <teks>
│ 🚫 .antilink on/off
│ 📅 .jadwal HH:MM <pesan>
│ 📋 .listjadwal
│ 🗑️ .hapusjadwal <nomor>
│
│ ⭐ .addakses (tag)
│ ❌ .delakses (tag)
│ 📋 .listakses
│
│ 👤 .addowner (tag)
│ ❌ .delowner (tag)
│ 📋 .listowner
╰───────────────
        `.trim()
      })
    }

    // ======================
    // LINK PS
    // ======================
    if (text === ".linkps") {
      if (!db.linkPS)
        return sock.sendMessage(from, { text: "📭 Link PS belum diset" })

      return sock.sendMessage(from, { text: `🔗 *Link PS:*\n${db.linkPS}` })
    }

    // ======================
    // SET LINK PS
    // ======================
    if (text.startsWith(".setlinkps")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const link = body.slice(10).trim()
      if (!link)
        return sock.sendMessage(from, { text: "❌ Tulis linknya\nContoh: .setlinkps https://wa.me/628xxx" })

      db.linkPS = link
      saveDB()
      return sock.sendMessage(from, { text: `✅ Link PS berhasil disimpan:\n${link}` })
    }

    // ======================
    // PROMOSI
    // ======================
    if (text === ".promosi") {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      if (!db.promosi)
        return sock.sendMessage(from, { text: "📭 Teks promosi belum diset" })

      return sock.sendMessage(from, { text: db.promosi })
    }

    // ======================
    // SET PROMOSI
    // ======================
    if (text.startsWith(".setpromosi")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const teks = body.slice(11).trim()
      if (!teks)
        return sock.sendMessage(from, { text: "❌ Tulis teks promosinya\nContoh: .setpromosi Halo! Kami buka order..." })

      db.promosi = teks
      saveDB()
      return sock.sendMessage(from, { text: "✅ Teks promosi berhasil disimpan" })
    }

    // ======================
    // ANTILINK ON/OFF
    // ======================
    if (text.startsWith(".antilink")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = text.split(" ")[1]
      if (arg !== "on" && arg !== "off")
        return sock.sendMessage(from, { text: "❌ Gunakan: .antilink on atau .antilink off" })

      const gs = getGS(from)
      gs.antilink = arg === "on"
      saveDB()
      return sock.sendMessage(from, {
        text: `🚫 Antilink *${arg.toUpperCase()}*\nAdmin & owner tetap bisa kirim link.`
      })
    }

    // ======================
    // SET WELCOME
    // ======================
    if (text.startsWith(".setwelcome")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const teks = body.slice(11).trim()
      if (!teks)
        return sock.sendMessage(from, {
          text: "❌ Tulis teks welcomenya\nVariabel tersedia:\n{user} = nama member\n{group} = nama grup\n{count} = jumlah member\n\nContoh:\n.setwelcome Halo @{user}! Selamat datang di {group} 🎉"
        })

      const gs = getGS(from)
      gs.welcome = teks
      saveDB()
      return sock.sendMessage(from, { text: `✅ Teks welcome disimpan:\n\n${teks}` })
    }

    // ======================
    // SET BYE
    // ======================
    if (text.startsWith(".setbye")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const teks = body.slice(7).trim()
      if (!teks)
        return sock.sendMessage(from, {
          text: "❌ Tulis teks byenya\nVariabel tersedia:\n{user} = nama member\n{group} = nama grup\n{count} = sisa member\n\nContoh:\n.setbye Sampai jumpa @{user} 👋"
        })

      const gs = getGS(from)
      gs.bye = teks
      saveDB()
      return sock.sendMessage(from, { text: `✅ Teks bye disimpan:\n\n${teks}` })
    }


    // ======================
    // JADWAL
    // ======================
    if (text.startsWith(".jadwal")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const args = body.slice(7).trim()
      if (!args)
        return sock.sendMessage(from, {
          text: "❌ Format salah\nContoh: .jadwal 08:00 Selamat pagi semua! 🌅"
        })

      const spasi = args.indexOf(" ")
      if (spasi === -1)
        return sock.sendMessage(from, {
          text: "❌ Pesannya kosong\nContoh: .jadwal 08:00 Selamat pagi semua!"
        })

      const waktu = args.slice(0, spasi).trim()
      const pesan = args.slice(spasi + 1).trim()

      if (!/^\d{2}:\d{2}$/.test(waktu))
        return sock.sendMessage(from, {
          text: "❌ Format waktu salah, gunakan HH:MM\nContoh: .jadwal 08:00 Halo!"
        })

      const [hh, mm] = waktu.split(":").map(Number)
      if (hh > 23 || mm > 59)
        return sock.sendMessage(from, { text: "❌ Waktu tidak valid" })

      if (!pesan)
        return sock.sendMessage(from, { text: "❌ Pesan tidak boleh kosong" })

      const id = Date.now()
      db.jadwal.push({ id, groupId: from, waktu, pesan, lastSent: "" })
      saveDB()

      return sock.sendMessage(from, {
        text: `✅ Jadwal disimpan!\n⏰ Waktu: ${waktu}\n📝 Pesan: ${pesan}\n\nAkan dikirim otomatis setiap hari.`
      })
    }

    // ======================
    // LIST JADWAL
    // ======================
    if (text === ".listjadwal") {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const jadwalGrup = db.jadwal.filter(j => j.groupId === from)
      if (jadwalGrup.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada jadwal di grup ini" })

      let teks = "📅 *LIST JADWAL:*\n\n"
      jadwalGrup.forEach((j, i) => {
        teks += `${i + 1}. ⏰ ${j.waktu}\n   📝 ${j.pesan}\n\n`
      })

      return sock.sendMessage(from, { text: teks.trim() })
    }

    // ======================
    // HAPUS JADWAL
    // ======================
    if (text.startsWith(".hapusjadwal")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const nomorStr = body.slice(12).trim()
      const nomor    = parseInt(nomorStr)

      if (!nomorStr || isNaN(nomor) || nomor < 1)
        return sock.sendMessage(from, { text: "❌ Tulis nomornya\nContoh: .hapusjadwal 1" })

      const jadwalGrup = db.jadwal.filter(j => j.groupId === from)
      if (nomor > jadwalGrup.length)
        return sock.sendMessage(from, { text: `❌ Nomor tidak ada. Total jadwal: ${jadwalGrup.length}` })

      const target = jadwalGrup[nomor - 1]
      db.jadwal = db.jadwal.filter(j => j.id !== target.id)
      saveDB()

      return sock.sendMessage(from, {
        text: `✅ Jadwal ⏰ ${target.waktu} berhasil dihapus`
      })
    }

    // ======================
    // ADD AKSES
    // ======================
    if (text.startsWith(".addakses")) {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Hanya di grup" })
      if (!isOwner && !isAdmin) return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (db.allowedUsers.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Sudah ada akses" })

      db.allowedUsers.push(targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `✅ Akses ditambahkan untuk @${targetNumber}`,
        mentions: [target]
      })
    }

    // ======================
    // DEL AKSES
    // ======================
    if (text.startsWith(".delakses")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (!db.allowedUsers.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Nomor itu tidak ada di daftar akses" })

      db.allowedUsers = db.allowedUsers.filter(v => normNum(v) !== targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `❌ Akses dihapus untuk @${targetNumber}`,
        mentions: [target]
      })
    }

    // ======================
    // LIST AKSES
    // ======================
    if (text === ".listakses") {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })
      if (db.allowedUsers.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada user yang punya akses" })

      let teks = "📋 *LIST AKSES:*\n\n"
      db.allowedUsers.forEach((u, i) => { teks += `${i + 1}. @${u}\n` })
      const mentions = db.allowedUsers.map(u => u + "@s.whatsapp.net")
      return sock.sendMessage(from, { text: teks, mentions })
    }

    // ======================
    // ADD OWNER
    // ======================
    if (text.startsWith(".addowner")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (db.owners.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Sudah jadi owner" })

      db.owners.push(targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `✅ @${targetNumber} ditambahkan sebagai owner`,
        mentions: [target]
      })
    }

    // ======================
    // DEL OWNER
    // ======================
    if (text.startsWith(".delowner")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (!db.owners.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Nomor itu bukan owner" })

      if (db.owners.length === 1 && normNum(db.owners[0]) === senderNumber)
        return sock.sendMessage(from, { text: "⚠️ Tidak bisa hapus owner terakhir" })

      db.owners = db.owners.filter(v => normNum(v) !== targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `❌ @${targetNumber} dihapus dari owner`,
        mentions: [target]
      })
    }

    // ======================
    // LIST OWNER
    // ======================
    if (text === ".listowner") {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })
      if (db.owners.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada owner terdaftar" })

      let teks = "👑 *LIST OWNER:*\n\n"
      db.owners.forEach((u, i) => { teks += `${i + 1}. @${u}\n` })
      const mentions = db.owners.map(u => u + "@s.whatsapp.net")
      return sock.sendMessage(from, { text: teks, mentions })
    }

    // ======================
    // KICK
    // ======================
    if (text.startsWith(".kick")) {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      if (!isGroup)   return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message?.extendedTextMessage?.contextInfo?.participant

      if (!target) return sock.sendMessage(from, { text: "❌ Reply/tag member" })
      if (groupAdmins.includes(target))
        return sock.sendMessage(from, { text: "❌ Tidak bisa kick admin" })

      await sock.groupParticipantsUpdate(from, [target], "remove")
      sock.sendMessage(from, {
        text: `✅ @${target.split("@")[0]} berhasil dikeluarkan`,
        mentions: [target]
      })
    }

    // ======================
    // DELETE PESAN
    // ======================
    if (text === ".del") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })

      const quoted = msg.message?.extendedTextMessage?.contextInfo
      if (!quoted) return sock.sendMessage(from, { text: "❌ Reply pesan" })

      await sock.sendMessage(from, {
        delete: {
          remoteJid: from, fromMe: false,
          id: quoted.stanzaId, participant: quoted.participant
        }
      })
    }

    // ======================
    // OPEN GROUP
    // ======================
    if (text === ".open") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      await sock.groupSettingUpdate(from, "not_announcement")
      sock.sendMessage(from, { text: "✅ Grup dibuka" })
    }

    // ======================
    // CLOSE GROUP
    // ======================
    if (text === ".close") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      await sock.groupSettingUpdate(from, "announcement")
      sock.sendMessage(from, { text: "🔒 Grup ditutup" })
    }

  } catch (err) {
    console.log("Error handler:", err)
  }
}
